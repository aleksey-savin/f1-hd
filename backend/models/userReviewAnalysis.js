const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      unique: true,
    },
    fingerprint: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "done", "error"],
      default: "pending",
      index: true,
    },
    events: { type: [mongoose.Schema.Types.Mixed], default: [] },
    method: { type: String, enum: ["rules", "ai", "cache"] },
    inputFingerprint: String,
    inputChars: Number,
    sourceCount: Number,
    selectedSourceCount: Number,
    checkedAt: Date,
    error: { type: String, default: "" },
    leaseUntil: Date,
    leaseToken: String,
    attempts: { type: Number, default: 0 },
    retryAt: Date,
    historical: { type: Boolean, default: false },
    stage: { type: String, enum: ["checking", "ai"] },
    startedAt: Date,
    stageStartedAt: Date,
  },
  { timestamps: true },
);
schema.index({ status: 1, retryAt: 1, leaseUntil: 1 });
module.exports = mongoose.model("UserReviewAnalysis", schema);
