const Mikrotik = require("@/models/mikrotik");

/**
 * Map ClientDevice _id → its Mikrotik management record (status / monitoring /
 * last-seen). Only devices that have a management record appear in the map, so
 * a missing key means "not managed", not "offline".
 *
 * One query per batch of devices: the environment widget, the tech list and the
 * device list all paint the same live dot, and each of them draws it for a page
 * of devices at once. Kept here rather than in a controller because two
 * controllers (inventory/location and inventory/clientDevice) need it.
 */
const buildMikrotikStatusMap = async (deviceIds) => {
  if (!deviceIds.length) return new Map();
  const records = await Mikrotik.find({
    clientDevice: { $in: deviceIds },
  }).select("clientDevice status monitoringEnabled lastSuccessfulConnectionAt");
  return new Map(records.map((record) => [String(record.clientDevice), record]));
};

/** Slim overlay fields shared by every device DTO. */
const mikrotikOverlay = (mikro) => ({
  mikrotikManaged: !!mikro,
  mikrotikStatus: mikro ? mikro.status || "offline" : null,
  mikrotikRecordId: mikro ? mikro._id : null,
  mikrotikMonitoringEnabled: mikro ? mikro.monitoringEnabled : false,
  mikrotikLastSeenAt: mikro ? mikro.lastSuccessfulConnectionAt || null : null,
});

module.exports = { buildMikrotikStatusMap, mikrotikOverlay };
