const { TIMING } = require("./upgradeConstants");

// Monitoring stays quiet for a device under a firmware upgrade and for devices
// reached through it: reboots are not outages. A flag older than
// STALE_UPGRADE_MS is ignored — a stuck worker must not hide a device forever.
const isUpgrading = (record, now = new Date()) =>
  Boolean(
    record?.upgrade?.jobId &&
      record.upgrade.since &&
      now.getTime() - new Date(record.upgrade.since).getTime() < TIMING.STALE_UPGRADE_MS,
  );

const quietUnderUpgrade = (record, recordsById, now = new Date()) =>
  isUpgrading(record, now) ||
  (record?.jumpRecordId
    ? isUpgrading(recordsById.get(String(record.jumpRecordId)), now)
    : false);

module.exports = { isUpgrading, quietUnderUpgrade };
