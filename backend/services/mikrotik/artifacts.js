const crypto = require("crypto");
const { pruneArtifacts, storeExport } = require("./artifactLifecycle");

const Mikrotik = require("../../models/mikrotik");
const MikrotikArtifact = require("../../models/mikrotikArtifact");
const {
  buildSshParams,
  withSshSession,
  exportConfig,
} = require("./connector");
const { resolveJumpContext } = require("./monitorState");
const { encryptArtifact, decryptArtifact } = require("../crypto/artifactBox");
const { redactConfig } = require("./configRedact");
const { diffConfigs, summarizeDiff } = require("./configDiff");
const { eventLog, userActor } = require("./events");
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

// Create a .rsc config export for a record over SSH (`/export` over stdout —
// nothing is written to the device), store it, record its metadata, prune
// retention, and pin the SSH host key TOFU. Throws on failure (SSRF / connection
// / host-key) — callers map that to an operator message or a stored lastError.
// Shared by the manual endpoint and the scheduler.
//
// What changed between the previous stored export and the new one, for the
// device journal. Both sides go through redactConfig, so no secret reaches the
// event; a missing or unreadable previous file leaves the event without detail.
const configChangeEvent = async (previous, buffer, recordId) => {
  try {
    const before = redactConfig(decryptArtifact(await storage.getArtifactBuffer(previous.storageKey)));
    const { lines, ...summary } = summarizeDiff(diffConfigs(before, redactConfig(buffer)));
    return { data: summary, diff: lines };
  } catch (error) {
    logger.log("warn", "Mikrotik config diff for the journal failed", {
      recordId,
      error: error.message,
    });
    return { data: { unknown: true } };
  }
};

// Binary `.backup` artifacts are intentionally NOT supported: RouterOS's SSH is
// CLI-only (no SFTP subsystem, and exec runs only RouterOS commands, so `scp` is
// refused). The .rsc export contains the commands visible to the RouterOS account.
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
    writeState: null,
    mikrotik: record._id,
    type: "export",
  })
    .sort({ createdAt: -1 })
    .select("contentHash storageKey");

  // Trust-on-first-use: pin the observed SSH host key on the first successful op.
  // Any successful export — manual or pre-upgrade too — also retires the error
  // of the last scheduled run: the device has just proved it can be copied, and
  // the stale error otherwise hangs on the record until the next scheduled run.
  const pinHostKey = hostKey && !record.credentials.sshHostKey;
  if (pinHostKey) {
    record.credentials.sshHostKey = hostKey;
    await record.save();
  }
  if (pinHostKey) await eventLog().record(record._id, "pinned", { data: { what: "ssh" } });

  // Envelope-encrypt the config before it leaves the process, so what lands in S3
  // / on disk is ciphertext an operator can't read without the application encryption key (an
  // .rsc may contain secrets). `size` stays the plaintext length — that's what the
  // 2FA download decrypts and streams back.
  const fileName = `${sanitizeBaseName(
    record.name || record.credentials.host,
  )}-${timestampForName(new Date(), prefs?.timezone)}.rsc`;

  const artifact = await storeExport({
    mikrotik: record._id,
    type: "export",
    trigger,
    storageKey,
    fileName,
    size: buffer.length,
    contentHash,
    routerOsVersion: record.currentFirmware,
    createdBy: userId || undefined,
  }, encryptArtifact(buffer));

  if (trigger !== "scheduled" && record.schedules?.export?.lastError) {
    await Mikrotik.updateOne({
      _id: record._id,
      "schedules.export.lastRunAt": record.schedules.export.lastRunAt ?? null,
      "schedules.export.lastError": record.schedules.export.lastError,
    }, { $unset: { "schedules.export.lastError": "" } });
  }

  // The device journal: the copy itself, and what differs from the previous one.
  // Read the previous file BEFORE pruning — pruning may be what removes it.
  const changed = Boolean(previous?.contentHash && previous.contentHash !== contentHash);
  await eventLog().record(record._id, "exportCreated", {
    actor: userActor(userId),
    data: { trigger },
    refs: { artifactId: artifact._id },
  });
  if (changed) {
    await eventLog().record(record._id, "configChanged", {
      ...(await configChangeEvent(previous, buffer, record._id)),
      refs: { artifactId: artifact._id },
    });
  }

  await pruneArtifacts(record, "export");

  // Config-change detection (opt-in). Best-effort — a raised ticket must never fail
  // an already-stored export, so it's wrapped and logged.
  if (changed) {
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
