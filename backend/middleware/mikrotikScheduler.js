const mongoose = require("mongoose");

const Mikrotik = require("../models/mikrotik");
const Preferences = require("../models/preferences");
const { mikrotikEnabled } = require("../services/mikrotik/enabled");
const { createArtifact } = require("../services/mikrotik/artifacts");
const { computeNextRun } = require("../services/mikrotik/schedule");
const { quietUnderUpgrade } = require("../services/mikrotik/upgradeGuard");
const logger = require("../utils/logger");

// How many devices to process concurrently per batch.
const BATCH_SIZE = 5;
const ACTIVE_FREQUENCIES = ["daily", "weekly", "monthly"];

// Reserve the observed slot before SSH. Another tick or a schedule edit can
// win the comparison without inheriting any writes from this stale snapshot.
const processRecord = async (record, timezone, now) => {
  const schedule = record.schedules.export;
  if (schedule.nextRunAt > now) return;
  const due = Boolean(schedule.nextRunAt);
  const changes = {
    "schedules.export.nextRunAt": computeNextRun(schedule, now, timezone),
  };
  if (due) changes["schedules.export.lastRunAt"] = now;
  const claim = await Mikrotik.updateOne(
    {
      _id: record._id,
      "schedules.export.frequency": schedule.frequency,
      "schedules.export.nextRunAt": schedule.nextRunAt ?? null,
    },
    { $set: changes },
  );
  if (!due || !claim.matchedCount) return;

  const run = { _id: record._id, "schedules.export.lastRunAt": now };
  try {
    await createArtifact(record, { trigger: "scheduled" });
  } catch (error) {
    await Mikrotik.updateOne(run, { $set: { "schedules.export.lastError": error.message } });
    logger.log("warn", "Mikrotik scheduled artifact failed", {
      recordId: record._id, type: "export", error: error.message,
    });
    return;
  }
  await Mikrotik.updateOne(run, {
    $set: { "schedules.export.lastSuccessAt": now },
    $unset: { "schedules.export.lastError": "" },
  });
};

// Background job: run every device whose config-export schedule is due.
// Registered as a cron in app.js. Safe to call when idle (no active schedules).
const runMikrotikScheduler = async () => {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  if (!(await mikrotikEnabled())) {
    return;
  }

  const scheduled = await Mikrotik.find({
    "schedules.export.frequency": { $in: ACTIVE_FREQUENCIES },
  });
  if (!scheduled.length) return;
  const jumpIds = [...new Set(scheduled.filter((r) => r.jumpRecordId).map((r) => String(r.jumpRecordId)))];
  const transits = jumpIds.length
    ? await Mikrotik.find({ _id: { $in: jumpIds } }).select("upgrade")
    : [];
  const byId = new Map(transits.map((r) => [String(r._id), r]));
  const prefs = await Preferences.findOne({}).lean();
  const timezone = prefs?.timezone;
  const now = new Date();
  const records = scheduled.filter((record) => !quietUnderUpgrade(record, byId, now));

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map((record) => processRecord(record, timezone, now)),
    );
  }

  logger.log("debug", "Mikrotik scheduler tick completed", {
    devices: records.length,
  });
};

module.exports = { runMikrotikScheduler };
