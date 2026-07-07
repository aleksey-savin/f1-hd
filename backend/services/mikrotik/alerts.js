const mongoose = require("mongoose");

const Mikrotik = require("../../models/mikrotik");
const Preferences = require("../../models/preferences");
const { createMikrotikTicket } = require("./tickets");
const logger = require("../../utils/logger");

// Human-readable device name for the ticket text (RouterOS identity / standalone
// label / host — never an internal id).
const deviceLabel = (record) =>
  record.name ||
  record.label ||
  record.credentials?.host ||
  "устройство Mikrotik";

const fmtTime = (date) =>
  date ? new Date(date).toLocaleString("ru-RU") : "неизвестно";

// Background job: raise ONE ticket per outage episode for monitored devices that
// have been offline longer than the configured threshold. Idempotent —
// `offlineAlertedAt` marks a device as already-alerted (the health-check clears it
// on recovery), so re-runs don't duplicate tickets. Reads the opt-in setting from
// Preferences. Registered as its own cron in app.js. Never throws per device — a
// failed create is logged and retried on the next tick.
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

  for (const record of devices) {
    const name = deviceLabel(record);
    const host = record.credentials?.host || "—";
    const minutes = Math.round(
      (Date.now() - record.offlineSince.getTime()) / 60000,
    );
    const description =
      `Устройство «${name}» (${host}) недоступно с ${fmtTime(record.offlineSince)} ` +
      `(более ${minutes} мин).\n` +
      (record.lastError ? `Последняя ошибка: ${record.lastError}\n` : "") +
      `Открыть в управлении Mikrotik: /devices/mikrotik?recordId=${record._id}`;

    const ticket = await createMikrotikTicket(record, {
      title: `Mikrotik недоступен: ${name}`,
      description,
      categoryId: cfg.categoryId || null,
    });
    if (!ticket) continue; // create failed (logged) — retry next tick

    record.offlineAlertedAt = new Date();
    record.alertTicketId = ticket._id;
    await record.save();

    logger.log("info", "Mikrotik offline alert ticket created", {
      recordId: record._id,
      ticketId: ticket._id,
    });
  }
};

module.exports = { runMikrotikOfflineAlerts };
