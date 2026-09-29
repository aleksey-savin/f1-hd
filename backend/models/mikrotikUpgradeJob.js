const mongoose = require("mongoose");

const {
  STEPS,
  ITEM_STATES,
  JOB_STATUSES,
  CHANNELS,
  CHANNEL_MODES,
  LEG_CHANNELS,
} = require("../services/mikrotik/upgradeConstants");

const Schema = mongoose.Schema;

// One firmware-upgrade batch (docs/mikrotik-management.md, «Firmware
// upgrades»). Items are embedded — a batch is a handful of devices — and are
// advanced one step per tick by services/mikrotik/upgradeWorker.js.
const versionPair = { os: String, boot: String };

const itemSchema = new Schema({
  mikrotik: { type: Schema.Types.ObjectId, ref: "Mikrotik", required: true },
  // Snapshot for the UI: the record may be renamed or deleted mid-batch.
  name: { type: String, required: true },
  // The final branch. A RouterOS 6 → 7 item walks `legs` to get there
  // (services/mikrotik/upgradeSteps.js): `leg` is the cursor, `hopTo` the
  // version the current leg installs, `path` the planned versions
  // [from, ...via, to] for the UI. A single-leg item has legs = [channel].
  channel: { type: String, enum: CHANNELS, required: true },
  legs: [{ type: String, enum: LEG_CHANNELS }],
  leg: { type: Number, default: 0 },
  hopTo: String,
  path: [String],
  state: { type: String, enum: ITEM_STATES, default: "queued" },
  step: { type: String, enum: STEPS },
  stepStartedAt: Date,
  // Stamped BEFORE the reboot command, so a restarted worker never reboots twice.
  rebootRequestedAt: Date,
  startedAt: Date,
  finishedAt: Date,
  from: versionPair,
  to: versionPair,
  artifactId: { type: Schema.Types.ObjectId, ref: "MikrotikArtifact" },
  error: String,
  fix: String,
  log: [{ _id: false, at: Date, text: String }],
});

const jobSchema = new Schema(
  {
    status: { type: String, enum: JOB_STATUSES, default: "running" },
    channelMode: { type: String, enum: CHANNEL_MODES, required: true },
    // «Перейти на RouterOS 7»: v6 devices in the batch get the multi-leg plan.
    toV7: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    finishedAt: Date,
    // «Остановить после текущего»: the running device finishes, the rest are skipped.
    cancelRequestedAt: Date,
    stopReason: String,
    items: [itemSchema],
  },
  { timestamps: true },
);

// One batch at a time, enforced by the database (a race of two «Обновить»).
jobSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: "running" } },
);
// Last upgrade of a device (record page).
jobSchema.index({ "items.mikrotik": 1, createdAt: -1 });

jobSchema.plugin(require("../services/pulsePlugin"), {
  model: "MikrotikUpgradeJob",
});

module.exports = mongoose.model("MikrotikUpgradeJob", jobSchema);
