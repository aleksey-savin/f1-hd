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

// SSRF guards for operator-supplied device hosts live in ./hostGuard (pure, so
// they can be tested without this module's storage and model dependencies).
const { assertPublicHost, assertJumpTargetHost } = require("./hostGuard");

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
  // Any successful export — manual or pre-upgrade too — also retires the error
  // of the last scheduled run: the device has just proved it can be copied, and
  // the stale error otherwise hangs on the record until the next scheduled run.
  const pinHostKey = hostKey && !record.credentials.sshHostKey;
  const staleError = Boolean(record.schedules?.export?.lastError);
  if (pinHostKey) record.credentials.sshHostKey = hostKey;
  if (staleError) {
    record.schedules.export.lastError = undefined;
    record.markModified("schedules");
  }
  if (pinHostKey || staleError) await record.save();

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
