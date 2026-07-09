const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// One document per outage episode of a monitored Mikrotik device. Opened on the
// online→offline edge (startedAt mirrors Mikrotik.offlineSince — the first failed
// poll, NOT the alert threshold), closed on recovery. Unlike the mutable
// offline-alert state on the Mikrotik record (cleared on recovery), episodes are
// kept — they are the source for the availability report.
const mikrotikOutageSchema = new Schema(
  {
    // Отдельный index:true не нужен — составной {mikrotik, startedAt} ниже
    // покрывает поиск по устройству своим префиксом.
    mikrotik: {
      type: Schema.Types.ObjectId,
      ref: "Mikrotik",
      required: true,
    },
    startedAt: { type: Date, required: true },
    // null/absent while the outage is ongoing.
    endedAt: { type: Date, default: null },
    // Present (true) only while ongoing; $unset on close. Exists so the partial
    // unique index below can enforce "one open episode per device" (a partial
    // index can match { open: true }, but not { endedAt: null }).
    open: { type: Boolean },
    // The offline-alert ticket raised for this episode (if the threshold was hit).
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
    lastError: String,
  },
  { timestamps: true },
);

// Availability report: list a device's episodes newest-first.
mikrotikOutageSchema.index({ mikrotik: 1, startedAt: -1 });

// At most one OPEN episode per device — makes the open/close bookkeeping safe
// against concurrent writers (health-check, alert cron, parameter saves).
mikrotikOutageSchema.index(
  { mikrotik: 1 },
  { unique: true, partialFilterExpression: { open: true } },
);

module.exports = mongoose.model("MikrotikOutage", mikrotikOutageSchema);
