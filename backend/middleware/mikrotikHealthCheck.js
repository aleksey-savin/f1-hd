const mongoose = require("mongoose");

const Mikrotik = require("../models/mikrotik");
const { pollWithRetry } = require("../services/mikrotik/connector");
const {
  pollParams,
  recoverToOnline,
  recordFailure,
} = require("../services/mikrotik/monitorState");
const logger = require("../utils/logger");

// How many devices to poll concurrently per batch. Polling is IO-bound, so this can
// grow with the fleet — a mass outage costs ~one poll deadline per batch.
const BATCH_SIZE = 5;

// Polls one monitored device and persists its connectivity status. All state
// transitions (and the anti-flap counters) live in services/mikrotik/monitorState.
const checkDevice = async (device) => {
  const now = new Date();

  try {
    const poll = await pollWithRetry(pollParams(device), {
      // The full-group guard belongs to verify-on-save: a least-privilege user can't
      // read /user at all, so here the read only ever burns its timeout.
      verifyFullGroup: false,
      // The serial number can't change between polls — read it once.
      readRouterboard: !device.serialNumber,
      // A device already in a confirmed outage doesn't need a second opinion.
      retry: device.status !== "offline",
    });
    await recoverToOnline(device, poll, now);
  } catch (error) {
    await recordFailure(device, error, now);
  }
};

// Background job: refresh the status of every device with monitoring enabled.
// Registered as a cron in app.js. Safe to call when idle (no monitored devices).
const runMikrotikHealthCheck = async () => {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const devices = await Mikrotik.find({ monitoringEnabled: true });
  if (devices.length === 0) {
    return;
  }

  for (let i = 0; i < devices.length; i += BATCH_SIZE) {
    const batch = devices.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map((device) => checkDevice(device)));
  }

  logger.log("debug", "Mikrotik health-check completed", {
    devices: devices.length,
  });
};

module.exports = { runMikrotikHealthCheck };
