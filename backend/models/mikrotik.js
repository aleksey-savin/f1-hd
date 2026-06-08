const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// A Mikrotik record is the management/connection layer attached 1:1 to an
// inventory ClientDevice. It is created lazily the first time parameters are
// saved; a manageable device without a record is treated as "not configured".
const mikrotikSchema = new Schema(
  {
    clientDevice: {
      type: Schema.Types.ObjectId,
      ref: "ClientDevice",
      required: true,
      unique: true,
    },
    credentials: {
      host: String,
      port: Number,
      user: String,
      // AES-256-GCM ciphertext (see services/crypto/secretBox). Never returned.
      password: String,
      // Transport: API-SSL (TLS) when true; the pinned self-signed device cert
      // (PEM, captured trust-on-first-use) verifies subsequent connections.
      useTls: { type: Boolean, default: true },
      tlsCert: String,
      // Port-knock sequence: AES-256-GCM ciphertext of a JSON port array. Secret.
      knockSequence: String,
    },
    // Polled live from the device.
    name: String,
    boardName: String,
    serialNumber: String,
    currentFirmware: String,
    addresses: [
      {
        address: String,
        network: String,
        interface: String,
        invalid: String,
        dynamic: String,
        disabled: String,
        comment: String,
      },
    ],
    // Connectivity from the last poll. Absence of a record => "not configured".
    status: {
      type: String,
      enum: ["online", "offline"],
    },
    // Whether the background health-check polls this device (connect/disconnect).
    monitoringEnabled: {
      type: Boolean,
      default: false,
    },
    lastSuccessfulConnectionAt: Date,
    lastCheckedAt: Date,
    lastError: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Mikrotik", mikrotikSchema);
