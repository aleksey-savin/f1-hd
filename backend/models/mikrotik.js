const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// A backup / config-export schedule with retention. Reused for both artifact
// types. frequency "off" disables it; nextRunAt is a cached fire time the
// scheduler tick compares against (recomputed after each run and on edit).
const buildScheduleDefinition = () => ({
  frequency: {
    type: String,
    enum: ["off", "daily", "weekly", "monthly"],
    default: "off",
  },
  time: { type: String, default: "03:00" }, // "HH:MM", local (Preferences tz)
  weekday: { type: Number, default: 1 }, // 0–6 (Sun–Sat); used for weekly
  dayOfMonth: { type: Number, default: 1 }, // 1–28; used for monthly
  keepLast: { type: Number, default: 10 }, // retention: keep the newest N
  lastRunAt: Date,
  lastSuccessAt: Date,
  lastError: String,
  nextRunAt: Date,
});

// A Mikrotik record is the management/connection layer for a device. Usually it
// is attached 1:1 to an inventory ClientDevice (created lazily on the first
// parameter save; a manageable device without a record is "not configured").
// It may also be "standalone" — no ClientDevice at all (e.g. a Cloud Hosted
// Router) — in which case clientDevice is unset and companyId/label identify it.
const mikrotikSchema = new Schema(
  {
    // Unset for standalone devices. Uniqueness among inventory-backed records is
    // enforced by the partial index below (standalone records are excluded, so
    // multiple of them don't collide on a missing value).
    clientDevice: {
      type: Schema.Types.ObjectId,
      ref: "ClientDevice",
    },
    // Standalone identity, used when there is no clientDevice.
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
    },
    label: {
      type: String,
      trim: true,
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
      // SSH is used to pull backups (.backup) and config exports (.rsc) — same
      // account/host/knock as the API poll. The device SSH host key is pinned
      // trust-on-first-use (a fingerprint), like the TLS cert above.
      sshPort: { type: Number, default: 22 },
      sshHostKey: String,
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
    // Automated backup / config-export schedules with retention (keep last N).
    // A cron tick runs any whose nextRunAt is due; frequency "off" = disabled.
    schedules: {
      backup: buildScheduleDefinition(),
      export: buildScheduleDefinition(),
    },
  },
  { timestamps: true },
);

// One management record per inventory device — enforced only among records that
// actually reference a ClientDevice. Standalone records leave clientDevice unset
// and are excluded, so they never collide on a missing value.
mikrotikSchema.index(
  { clientDevice: 1 },
  {
    unique: true,
    partialFilterExpression: { clientDevice: { $exists: true } },
  },
);

module.exports = mongoose.model("Mikrotik", mikrotikSchema);
