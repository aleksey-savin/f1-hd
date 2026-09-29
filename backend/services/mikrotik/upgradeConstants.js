// Firmware upgrade (docs/mikrotik-management.md, «Firmware upgrades»): enums
// and timings shared by the model, the planner, the step machine, the worker
// and the monitoring guard. No imports — safe to require from anywhere.

// Execution order of one device's steps (services/mikrotik/upgradeSteps.js).
const STEPS = [
  "export",
  "channel",
  "check",
  "download",
  "reboot",
  "wait",
  "routerboot",
  "routerbootReboot",
  "routerbootWait",
  "verify",
];

const ITEM_STATES = ["queued", "running", "done", "failed", "skipped"];
const JOB_STATUSES = ["running", "done", "stopped", "cancelled"];
const CHANNELS = ["long-term", "stable"];
// «Как на устройстве» + an explicit branch for the whole batch.
const CHANNEL_MODES = ["current", ...CHANNELS];
// Channels a single leg of an item may set on the device. `upgrade` is
// MikroTik's v6 → v7 bridge: check-for-updates on it offers a v7 build to a
// device on the latest v6. Never a batch mode — only a leg in between.
const LEG_CHANNELS = [...CHANNELS, "upgrade"];
// MikroTik asks for 64 MB RAM on RouterOS 7; 64-MB boards report a little
// under 64 MiB in /system/resource, so the bar sits at 60 MiB.
const V7_MIN_MEMORY = 60 * 1024 * 1024;

const MINUTE = 60 * 1000;
const TIMING = {
  // A reboot takes at least this long; polling earlier only reaches the old system.
  MIN_REBOOT_MS: 45 * 1000,
  // The old version after this long means the install did not happen.
  OLD_VERSION_GRACE_MS: 3 * MINUTE,
  // No answer this long after a reboot: the device did not come back — stop the batch.
  WAIT_LIMIT_MS: 10 * MINUTE,
  // The first boot into v7 converts the configuration and is slow: the
  // `upgrade` leg gets twice the time before the batch is stopped.
  MAJOR_WAIT_LIMIT_MS: 20 * MINUTE,
  VERIFY_LIMIT_MS: 5 * MINUTE,
  DOWNLOAD_TIMEOUT_MS: 10 * MINUTE,
  // `check-for-updates` may answer before the check is over: re-print the
  // update row this often, for at most this long (well inside the 90-s API
  // session of upgradeDevice.checkUpdates).
  CHECK_POLL_MS: 3 * 1000,
  CHECK_WAIT_MS: 45 * 1000,
  // Monitoring ignores an `upgrade` flag older than this (a stuck worker must
  // not hide a device forever).
  STALE_UPGRADE_MS: 90 * MINUTE,
};

module.exports = {
  STEPS,
  ITEM_STATES,
  JOB_STATUSES,
  CHANNELS,
  CHANNEL_MODES,
  LEG_CHANNELS,
  V7_MIN_MEMORY,
  TIMING,
};
