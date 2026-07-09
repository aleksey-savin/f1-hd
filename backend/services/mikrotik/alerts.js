const mongoose = require("mongoose");

const Mikrotik = require("../../models/mikrotik");
const Preferences = require("../../models/preferences");
const {
  createMikrotikTicket,
  deviceLabel,
  fmtTime,
  deviceLinkHtml,
} = require("./tickets");
const { attachTicket } = require("./outages");
const { pollWithRetry } = require("./connector");
const { pollParams, recoverToOnline } = require("./monitorState");
const logger = require("../../utils/logger");

// How many candidates to re-poll concurrently.
const BATCH_SIZE = 5;

// Ask the device itself whether it is really down. The `status` field is at best a
// few minutes old, and a ticket is expensive to be wrong about — so before raising
// one, poll. A device that answers here is recovered on the spot and never ticketed.
// Returns true when the device is confirmed unreachable.
const stillOffline = async (record) => {
  try {
    // Up/down only: no full-group guard, no serial — keep the check cheap.
    const poll = await pollWithRetry(pollParams(record), {
      verifyFullGroup: false,
      readRouterboard: false,
    });
    await recoverToOnline(record, poll);
    logger.log("warn", "Mikrotik offline alert suppressed: device answered", {
      recordId: record._id,
      host: record.credentials?.host,
      offlineSince: record.offlineSince,
    });
    return false;
  } catch {
    return true;
  }
};

// Raise the ticket for one confirmed-offline device.
//
// Claim first, create second. The claim is a compare-and-set on offlineAlertedAt:
// it fails when the device has recovered (status is no longer "offline") or when it
// was already alerted, and only then do we create the ticket. The reverse order
// would leave an orphan ticket behind whenever the claim lost the race.
//
// Correctness here relies on the deployment running ONE backend process: the crons
// hold in-process locks and are scheduled on different minutes (see app.js). Scaling
// to replicas would need a distributed lock instead.
const raiseTicket = async (record, cfg, prefs) => {
  const claimed = await Mikrotik.findOneAndUpdate(
    { _id: record._id, status: "offline", offlineAlertedAt: null },
    { $set: { offlineAlertedAt: new Date() } },
    { new: false },
  );
  if (!claimed) return; // recovered, or another pass already claimed it

  const name = deviceLabel(record);
  const host = record.credentials?.host || "—";
  const minutes = Math.round(
    (Date.now() - record.offlineSince.getTime()) / 60000,
  );
  // Описание рендерится как HTML (веб-карточка заявки + письма): переносы —
  // <br/>, ссылка — кликабельный якорь на страницу устройства.
  const description =
    `Устройство «${name}» (${host}) недоступно с ` +
    `${fmtTime(record.offlineSince, prefs?.timezone)} (более ${minutes} мин).<br/>` +
    (record.lastError ? `Последняя ошибка: ${record.lastError}<br/>` : "") +
    deviceLinkHtml(record);

  const ticket = await createMikrotikTicket(record, {
    title: `Mikrotik недоступен: ${name}`,
    description,
    categoryId: cfg.categoryId || null,
  });
  if (!ticket) {
    // Create failed (logged by the factory) — release the claim so the next tick
    // retries instead of leaving the device permanently "already alerted".
    await Mikrotik.updateOne(
      { _id: record._id, alertTicketId: null },
      { $unset: { offlineAlertedAt: "" } },
    );
    return;
  }

  // Guarded: a recovery landing between the claim and here has cleared
  // offlineAlertedAt, and re-stamping the ticket would block all future alerts.
  await Mikrotik.updateOne(
    { _id: record._id, offlineAlertedAt: { $ne: null }, alertTicketId: null },
    { $set: { alertTicketId: ticket._id } },
  );

  // Stamp the ticket onto the outage episode for the availability report.
  await attachTicket(record, ticket._id);

  logger.log("info", "Mikrotik offline alert ticket created", {
    recordId: record._id,
    ticketId: ticket._id,
  });
};

// Background job: raise ONE ticket per outage episode for monitored devices that
// have been offline longer than the configured threshold. Idempotent —
// `offlineAlertedAt` marks a device as already-alerted (recovery clears it), so
// re-runs don't duplicate tickets. Reads the opt-in setting from Preferences.
// Registered as its own cron in app.js. Never throws per device — a failed create
// is logged and retried on the next tick.
const runMikrotikOfflineAlerts = async () => {
  if (mongoose.connection.readyState !== 1) return;

  const prefs = await Preferences.findOne({});
  const cfg = prefs?.mikrotik?.offlineTicket;
  if (!cfg?.isActive) return;

  const thresholdMs = (cfg.thresholdMinutes || 15) * 60 * 1000;
  const cutoff = new Date(Date.now() - thresholdMs);

  const devices = await Mikrotik.find({
    monitoringEnabled: true,
    status: "offline",
    offlineSince: { $ne: null, $lte: cutoff },
    offlineAlertedAt: null,
  });
  if (devices.length === 0) return;

  const alertIfDown = async (record) => {
    if (!(await stillOffline(record))) return;
    await raiseTicket(record, cfg, prefs);
  };

  for (let i = 0; i < devices.length; i += BATCH_SIZE) {
    const batch = devices.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map((record) => alertIfDown(record)));
  }
};

module.exports = { runMikrotikOfflineAlerts };
