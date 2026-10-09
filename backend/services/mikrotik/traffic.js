const Mikrotik = require("../../models/mikrotik");
const MikrotikTrafficHour = require("../../models/mikrotikTrafficHour");
const { sumRxBytes, nextSample } = require("./trafficSample");
const logger = require("../../utils/logger");

// Persist one traffic sample. `record` is the PRE-update document (its
// `traffic` is the previous sample). Best-effort and never throws: activity
// bookkeeping must not be able to break the health-check.
const recordTraffic = async (record, interfaces, now = new Date()) => {
  try {
    const counter = sumRxBytes(interfaces);
    if (counter === null || !record?._id) return;

    const { traffic, bucket } = nextSample(record.traffic, counter, now);
    await Mikrotik.updateOne({ _id: record._id }, { $set: { traffic } });
    if (bucket) {
      await MikrotikTrafficHour.updateOne(
        { mikrotik: record._id, hour: bucket.hour },
        { $inc: { bytes: bucket.bytes, seconds: bucket.seconds } },
        { upsert: true },
      );
    }
  } catch (error) {
    logger.log("debug", "Mikrotik traffic sample not saved", {
      recordId: record?._id,
      error: error.message,
    });
  }
};

// Deleting a monitoring record removes its activity history too.
const deleteTraffic = async (recordId) => {
  try {
    await MikrotikTrafficHour.deleteMany({ mikrotik: recordId });
  } catch (error) {
    logger.log("warn", "Mikrotik traffic history not deleted", {
      recordId,
      error: error.message,
    });
  }
};

module.exports = { recordTraffic, deleteTraffic };
