const mongoose = require("mongoose");

// Short-lived, single-use email OTP that gates a config-export download (step-up
// 2FA). Only the sha256 hash is stored; the plaintext 6-digit code is emailed to
// the requesting user. One active code per (user, artifact). Mongo's TTL index
// auto-removes expired codes; verification still checks `expiresAt` explicitly.
const mikrotikDownloadCodeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    artifact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MikrotikArtifact",
      required: true,
    },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

mikrotikDownloadCodeSchema.index({ user: 1, artifact: 1 });
mikrotikDownloadCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.MikrotikDownloadCode ||
  mongoose.model("MikrotikDownloadCode", mikrotikDownloadCodeSchema);
