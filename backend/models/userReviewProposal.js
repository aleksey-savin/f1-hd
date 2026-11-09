const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    ticketIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Ticket" }],
    kind: {
      type: String,
      enum: ["departure", "inactivity", "deletion", "unresolved"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "disabled",
        "deleted",
        "dismissed",
        "deferred",
        "restored",
      ],
      default: "pending",
    },
    evidence: { type: [mongoose.Schema.Types.Mixed], default: [] },
    manualBindings: { type: [mongoose.Schema.Types.Mixed], default: [] },
    matchedCandidates: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    decisionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decisionAt: Date,
    reason: { type: String, default: "" },
    analysisReason: { type: String, default: "" },
    blocked: { type: Boolean, default: false },
    actionable: { type: Boolean, default: false },
    systemDismissed: { type: Boolean, default: false },
    deferredUntil: Date,
  },
  { timestamps: true },
);
schema.index({ status: 1, kind: 1, updatedAt: -1 });
schema.index({ ticketIds: 1, status: 1 });
schema.index({ "manualBindings.ticketId": 1 });
module.exports = mongoose.model("UserReviewProposal", schema);
