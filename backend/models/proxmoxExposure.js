const mongoose = require("mongoose");
const { Schema } = mongoose;
const ref = (model) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required: true,
});
const networkLinkSchema = new Schema({
  connectionId: ref("ProxmoxConnection"),
  nodeName: { type: String, required: true },
  bridge: { type: String, required: true },
  vlan: { type: Number, default: null },
  cidr: { type: String, required: true },
  routerId: ref("Mikrotik"),
  lanInterface: { type: String, required: true },
  wan: { kind: { type: String, enum: ["interface", "list"] }, name: String },
});
const routerSchema = new Schema(
  {
    routerId: { ...ref("Mikrotik"), unique: true },
    revision: String,
    checkedAt: Date,
    lastAttemptAt: Date,
    status: { type: String, default: "unknown" },
    lastError: String,
    data: { type: Schema.Types.Mixed, select: false },
    leaseToken: { type: String, select: false },
    leaseUntil: { type: Date, select: false },
  },
  { timestamps: true },
);
const guestSchema = new Schema(
  {
    resourceId: { ...ref("ProxmoxResource"), unique: true },
    generation: Number,
    inputVersions: { type: Schema.Types.Mixed, select: false },
    reportVersion: String,
    checkedAt: Date,
    freshUntil: Date,
    report: { type: Schema.Types.Mixed, select: false },
    issue: { type: Schema.Types.Mixed, select: false },
  },
  { timestamps: true },
);
module.exports = {
  networkLinkSchema,
  RouterExposureSnapshot: mongoose.model(
    "RouterExposureSnapshot",
    routerSchema,
  ),
  GuestExposure: mongoose.model("GuestExposure", guestSchema),
};
