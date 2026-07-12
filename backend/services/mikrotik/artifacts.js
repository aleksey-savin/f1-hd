const net = require("net");
const dns = require("dns").promises;
const crypto = require("crypto");

const MikrotikArtifact = require("../../models/mikrotikArtifact");
const {
  buildSshParams,
  withSshSession,
  exportConfig,
} = require("./connector");
const { resolveJumpContext } = require("./monitorState");
const { encryptArtifact } = require("../crypto/artifactBox");
const storage = require("../storage");
const Preferences = require("../../models/preferences");
const { createMikrotikTicket, deviceLinkHtml } = require("./tickets");
const { formatInAppTimezone } = require("../../utils/datetime");
const logger = require("../../utils/logger");

// Normalize an export for change-detection: drop comment/header lines (the volatile
// "# <date> by RouterOS" timestamp lives there) and trailing whitespace, so only
// the actual config commands are hashed.
const normalizeConfig = (buffer) =>
  buffer
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .trim();

const configHash = (buffer) =>
  crypto.createHash("sha256").update(normalizeConfig(buffer)).digest("hex");

// --- SSRF guard: the device host is operator-supplied, so refuse to open
// connections to loopback / private / link-local (incl. cloud-metadata) targets.
const isBlockedIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return (
      low === "::1" ||
      low.startsWith("fe80") ||
      low.startsWith("fc") ||
      low.startsWith("fd")
    );
  }
  return false;
};

const assertPublicHost = async (host) => {
  let ips;
  if (net.isIP(host)) {
    ips = [host];
  } else {
    const resolved = await dns.lookup(host, { all: true });
    ips = resolved.map((entry) => entry.address);
  }
  if (ips.some(isBlockedIp)) {
    const error = new Error(
      `Хост ${host} указывает на внутренний адрес и запрещён`,
    );
    error.code = "MIKROTIK_BLOCKED_HOST";
    throw error;
  }
};

// Мягкий SSRF-guard для целей за транзитом («подключение через устройство»):
// адрес за роутером — LAN, поэтому RFC1918/ULA легитимны; блокируются только
// loopback/link-local/0.0.0.0 и литерал localhost (незачем указывать роутеру
// на самого себя или в облачную метадату). Имена НЕ резолвятся: их резолвит
// роутер в своей сети, взгляд бэкенда на DNS нерелевантен.
const assertJumpTargetHost = (host) => {
  const blocked = (() => {
    if (net.isIPv4(host)) {
      const [a, b] = host.split(".").map(Number);
      return a === 127 || a === 0 || (a === 169 && b === 254);
    }
    if (net.isIPv6(host)) {
      const low = host.toLowerCase();
      return low === "::1" || low === "::" || low.startsWith("fe80");
    }
    return String(host).trim().toLowerCase() === "localhost";
  })();
  if (blocked) {
    const error = new Error(
      `Хост ${host} недопустим для подключения через транзитное устройство`,
    );
    error.code = "MIKROTIK_BLOCKED_HOST";
    throw error;
  }
};

// Filesystem-safe base for a human download name.
const sanitizeBaseName = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "mikrotik";

// Compact timestamp for a filename ("YYYY-MM-DD-HHmm") in the app timezone —
// the server runs UTC, and a UTC-stamped name would not match the times the
// operator sees in the UI.
const timestampForName = (date, timeZone) =>
  formatInAppTimezone(date, timeZone, "yyyy-MM-dd-HHmm");

// Retention: keep only the newest `keepLast` artifacts of a type; delete the
// rest from storage and the DB. Runs after every successful create.
const pruneArtifacts = async (record, type) => {
  const keepLast = record.schedules?.[type]?.keepLast ?? 10;
  if (!keepLast || keepLast < 1) return;
  const stale = await MikrotikArtifact.find({ mikrotik: record._id, type })
    .sort({ createdAt: -1 })
    .skip(keepLast)
    .select("_id storageKey");
  for (const doc of stale) {
    await storage.deleteArtifact(doc.storageKey);
    await MikrotikArtifact.deleteOne({ _id: doc._id });
  }
};

// Create a .rsc config export for a record over SSH (`/export` over stdout —
// nothing is written to the device), store it, record its metadata, prune
// retention, and pin the SSH host key TOFU. Throws on failure (SSRF / connection
// / host-key) — callers map that to an operator message or a stored lastError.
// Shared by the manual endpoint and the scheduler.
//
// Binary `.backup` artifacts are intentionally NOT supported: RouterOS's SSH is
// CLI-only (no SFTP subsystem, and exec runs only RouterOS commands, so `scp` is
// refused), so a binary file cannot be pulled over SSH. The .rsc export is a
// complete, restorable (`/import`) configuration and serves as the backup.
const createArtifact = async (
  record,
  { trigger = "manual", userId = null } = {},
) => {
  // Транзитная цель — LAN-адрес за роутером: мягкий guard; прямая — как раньше.
  // Висячая ссылка на транзит даёт MIKROTIK_JUMP_RECORD_MISSING (422 / lastError).
  const jumpCtx = await resolveJumpContext(record);
  if (record.jumpRecordId) assertJumpTargetHost(record.credentials.host);
  else await assertPublicHost(record.credentials.host);

  // Настройки нужны дважды: таймзона для имени файла и опция config-change ниже.
  const prefs = await Preferences.findOne({});

  const storageKey = `${crypto.randomUUID()}.rsc`;

  const { result: buffer, hostKey } = await withSshSession(
    { ...buildSshParams(record), jump: jumpCtx?.params },
    (conn) => exportConfig(conn),
  );

  // Hash the new config and grab the previous export's hash for change detection.
  const contentHash = configHash(buffer);
  const previous = await MikrotikArtifact.findOne({
    mikrotik: record._id,
    type: "export",
  })
    .sort({ createdAt: -1 })
    .select("contentHash");

  // Trust-on-first-use: pin the observed SSH host key on the first successful op.
  if (hostKey && !record.credentials.sshHostKey) {
    record.credentials.sshHostKey = hostKey;
    await record.save();
  }

  // Envelope-encrypt the config before it leaves the process, so what lands in S3
  // / on disk is ciphertext an operator can't read without MIKROTIK_ENC_KEY (an
  // .rsc may contain secrets). `size` stays the plaintext length — that's what the
  // 2FA download decrypts and streams back.
  const { storage: storageBackend } = await storage.putArtifact(
    storageKey,
    encryptArtifact(buffer),
    "application/octet-stream",
  );

  const fileName = `${sanitizeBaseName(
    record.name || record.credentials.host,
  )}-${timestampForName(new Date(), prefs?.timezone)}.rsc`;

  const artifact = await MikrotikArtifact.create({
    mikrotik: record._id,
    type: "export",
    trigger,
    storageKey,
    fileName,
    size: buffer.length,
    contentHash,
    storage: storageBackend,
    routerOsVersion: record.currentFirmware,
    createdBy: userId || undefined,
  });

  await pruneArtifacts(record, "export");

  // Config-change detection (opt-in). Best-effort — a raised ticket must never fail
  // an already-stored export, so it's wrapped and logged.
  if (previous?.contentHash && previous.contentHash !== contentHash) {
    try {
      const cfg = prefs?.mikrotik?.configChangeTicket;
      if (cfg?.isActive) {
        const name =
          record.name ||
          record.label ||
          record.credentials?.host ||
          "устройство Mikrotik";
        await createMikrotikTicket(record, {
          title: `Изменилась конфигурация Mikrotik: ${name}`,
          // Описание — HTML (веб-карточка + письма): якорь кликабелен.
          description:
            `Конфигурация устройства «${name}» (${record.credentials?.host || "—"}) ` +
            `изменилась по сравнению с предыдущим экспортом.<br/>` +
            deviceLinkHtml(record),
          categoryId: cfg.categoryId || null,
        });
      }
    } catch (error) {
      logger.log("error", "Mikrotik config-change detection failed", {
        error: error.message,
        recordId: record._id,
      });
    }
  }

  return artifact;
};

module.exports = {
  assertPublicHost,
  assertJumpTargetHost,
  createArtifact,
  pruneArtifacts,
};
