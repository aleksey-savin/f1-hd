const mongoose = require("mongoose");

const Mikrotik = require("../models/mikrotik");
const { pollWithRetry } = require("../services/mikrotik/connector");
const {
  pollParams,
  jumpRecordMissingError,
  loadJumpContexts,
  recoverToOnline,
  recordFailure,
} = require("../services/mikrotik/monitorState");
const logger = require("../utils/logger");

// How many units to poll concurrently per batch. Polling is IO-bound, so this can
// grow with the fleet — a mass outage costs ~one poll deadline per batch.
const BATCH_SIZE = 5;

// Gateway-scoped transit failures: identical for every dependent of the same
// router, so once seen, the rest of the unit is failed without polling.
// MIKROTIK_JUMP_CONNECT_FAILED is deliberately NOT here — «роутер не дотянулся
// до цели» is a per-device verdict (wrong LAN address / firewall on that switch).
const GATEWAY_SCOPED_CODES = new Set([
  "MIKROTIK_JUMP_UNREACHABLE",
  "MIKROTIK_JUMP_AUTH_FAILED",
  "MIKROTIK_JUMP_HOSTKEY_MISMATCH",
  "MIKROTIK_JUMP_FORWARD_PROHIBITED",
  "MIKROTIK_JUMP_RECORD_MISSING",
]);

// Polls one monitored device and persists its connectivity status. All state
// transitions (and the anti-flap counters) live in services/mikrotik/monitorState.
// Returns the poll error (null on success) so a unit can short-circuit on
// gateway-scoped transit failures.
const checkDevice = async (device, jumpCtx) => {
  const now = new Date();

  try {
    // Транзит задан, но контекст не загрузился (висячая ссылка / битые креды
    // роутера) — устройство недостижимо по построению, поллить нечего.
    if (device.jumpRecordId && !jumpCtx) throw jumpRecordMissingError();

    const poll = await pollWithRetry(
      { ...pollParams(device), jump: jumpCtx?.params },
      {
        // The full-group guard belongs to verify-on-save: a least-privilege user can't
        // read /user at all, so here the read only ever burns its timeout.
        verifyFullGroup: false,
        // The serial number can't change between polls — read it once.
        readRouterboard: !device.serialNumber,
        // A device already in a confirmed outage doesn't need a second opinion.
        retry: device.status !== "offline",
      },
    );
    await recoverToOnline(device, poll, now);
    return null;
  } catch (error) {
    await recordFailure(device, error, now);
    return error;
  }
};

// One unit = one direct device, or ALL dependents of one transit router
// (polled sequentially — per-router SSH concurrency stays at 1, so five
// tunneled polls never hammer a weak board at once). A gateway-scoped failure
// fails the rest of the unit without polling — each device still gets
// recordFailure, so anti-flap and outage accounting stay honest, and a dead
// router costs the tick ~one deadline instead of N.
const runUnit = async (unit, jumpContexts) => {
  let gatewayError = null;
  for (const device of unit) {
    if (gatewayError) {
      await recordFailure(device, gatewayError, new Date());
      continue;
    }
    const jumpCtx = device.jumpRecordId
      ? jumpContexts.get(String(device.jumpRecordId))
      : null;
    const error = await checkDevice(device, jumpCtx);
    if (
      error &&
      device.jumpRecordId &&
      GATEWAY_SCOPED_CODES.has(String(error.code || ""))
    ) {
      gatewayError = error;
    }
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

  // Один запрос на тик: контексты всех уникальных транзитов.
  const jumpContexts = await loadJumpContexts(devices);

  // Direct devices are units of one; dependents are grouped per router.
  const unitByRouter = new Map();
  const units = [];
  for (const device of devices) {
    if (!device.jumpRecordId) {
      units.push([device]);
      continue;
    }
    const key = String(device.jumpRecordId);
    if (!unitByRouter.has(key)) {
      const unit = [];
      unitByRouter.set(key, unit);
      units.push(unit);
    }
    unitByRouter.get(key).push(device);
  }

  for (let i = 0; i < units.length; i += BATCH_SIZE) {
    const batch = units.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map((unit) => runUnit(unit, jumpContexts)));
  }

  logger.log("debug", "Mikrotik health-check completed", {
    devices: devices.length,
  });
};

module.exports = { runMikrotikHealthCheck };
