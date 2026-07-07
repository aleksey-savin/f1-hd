const mongoose = require("mongoose");

const Mikrotik = require("../models/mikrotik");
const Preferences = require("../models/preferences");
const { createArtifact } = require("../services/mikrotik/artifacts");
const { computeNextRun } = require("../services/mikrotik/schedule");
const logger = require("../utils/logger");

// How many devices to process concurrently per batch.
const BATCH_SIZE = 5;
// Only config exports are scheduled — binary backups aren't supported over
// RouterOS's CLI-only SSH (see services/mikrotik/artifacts.js).
const TYPES = ["export"];
const ACTIVE_FREQUENCIES = ["daily", "weekly", "monthly"];

// Runs one due schedule (config export) for a device, then advances its run
// state. Failures are recorded on the schedule (never thrown) so one bad device
// can't stop the tick.
const runDueSchedule = async (record, type, timezone) => {
  const schedule = record.schedules[type];
  const now = new Date();
  try {
    await createArtifact(record, { trigger: "scheduled" });
    schedule.lastRunAt = now;
    schedule.lastSuccessAt = now;
    schedule.lastError = undefined;
  } catch (error) {
    schedule.lastRunAt = now;
    schedule.lastError = error.message;
    logger.log("warn", "Mikrotik scheduled artifact failed", {
      recordId: record._id,
      type,
      error: error.message,
    });
  } finally {
    schedule.nextRunAt = computeNextRun(schedule, new Date(), timezone);
    record.markModified("schedules");
    await record.save();
  }
};

// For one device, run whichever schedules are due (nextRunAt in the past). A
// missing nextRunAt (e.g. a legacy record) is computed without running.
const processRecord = async (record, timezone, now) => {
  for (const type of TYPES) {
    const schedule = record.schedules?.[type];
    if (!schedule || schedule.frequency === "off") continue;

    if (!schedule.nextRunAt) {
      schedule.nextRunAt = computeNextRun(schedule, now, timezone);
      record.markModified("schedules");
      await record.save();
      continue;
    }

    if (schedule.nextRunAt <= now) {
      await runDueSchedule(record, type, timezone);
    }
  }
};

// Background job: run every device whose config-export schedule is due.
// Registered as a cron in app.js. Safe to call when idle (no active schedules).
const runMikrotikScheduler = async () => {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const records = await Mikrotik.find({
    "schedules.export.frequency": { $in: ACTIVE_FREQUENCIES },
  });
  if (records.length === 0) {
    return;
  }

  const prefs = await Preferences.findOne({}).lean();
  const timezone = prefs?.timezone;
  const now = new Date();

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
