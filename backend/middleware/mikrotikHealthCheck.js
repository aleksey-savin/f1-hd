const mongoose = require("mongoose");

const Mikrotik = require("../models/mikrotik");
const {
  decryptSecret,
  pollDevice,
  mapPollToFields,
} = require("../services/mikrotik/connector");
const {
  markRecovered,
  ensureOpenOutage,
} = require("../services/mikrotik/outages");
const logger = require("../utils/logger");

// How many devices to poll concurrently per batch.
const BATCH_SIZE = 5;

// Decrypts a stored knock sequence ("v1:…" of a JSON port array) to numbers.
const decodeKnockSequence = (blob) => {
  if (!blob) return undefined;
  try {
    const arr = JSON.parse(decryptSecret(blob));
    return Array.isArray(arr) ? arr : undefined;
  } catch {
    return undefined;
  }
};

// Polls one monitored device and persists its connectivity status.
const checkDevice = async (device) => {
  const now = new Date();

  try {
    const result = await pollDevice({
      host: device.credentials.host,
      port: device.credentials.port,
      user: device.credentials.user,
      password: decryptSecret(device.credentials.password),
      tlsCert: device.credentials.tlsCert,
      knockSequence: decodeKnockSequence(device.credentials.knockSequence),
    });

    Object.assign(device, mapPollToFields(result));
    if (result.tlsCert && !device.credentials.tlsCert) {
      device.credentials.tlsCert = result.tlsCert; // pin trust-on-first-use cert
    }
    device.status = "online";
    device.lastSuccessfulConnectionAt = now;
    device.lastCheckedAt = now;
    device.lastError = undefined;
    // Recovery: close the outage episode + comment on the alert ticket (if any),
    // then clear the offline-alert state so the next outage can alert again. The
    // alert ticket itself is intentionally left open for a human to close.
    if (device.offlineSince) {
      await markRecovered(device);
      device.offlineSince = undefined;
      device.offlineAlertedAt = undefined;
      device.alertTicketId = undefined;
    }
  } catch (error) {
    device.status = "offline";
    device.lastCheckedAt = now;
    device.lastError = error.message;
    // Mark the start of the outage on the online→offline edge; kept (not
    // overwritten) across subsequent failed polls until recovery. The separate
    // offline-alert cron measures duration against this.
    if (!device.offlineSince) {
      device.offlineSince = now;
    }
    // Keep the outage episode open/fresh (self-heals a missing one).
    await ensureOpenOutage(device);
  }

  await device.save();
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
