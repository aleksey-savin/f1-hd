const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Network activity of a monitored Mikrotik device, one document per UTC hour.
// Filled by the health-check (services/mikrotik/traffic.js): `bytes` is the sum
// of accepted counter deltas that landed in the hour, `seconds` the time those
// deltas cover — a partly covered hour is told apart from a quiet one.
const mikrotikTrafficHourSchema = new Schema({
  mikrotik: { type: Schema.Types.ObjectId, ref: "Mikrotik", required: true },
  hour: { type: Date, required: true },
  bytes: { type: Number, default: 0 },
  seconds: { type: Number, default: 0 },
});

mikrotikTrafficHourSchema.index({ mikrotik: 1, hour: 1 }, { unique: true });
// Eight weeks of history is all the weekly profile reads.
mikrotikTrafficHourSchema.index({ hour: 1 }, { expireAfterSeconds: 56 * 24 * 60 * 60 });

module.exports = mongoose.model("MikrotikTrafficHour", mikrotikTrafficHourSchema);
