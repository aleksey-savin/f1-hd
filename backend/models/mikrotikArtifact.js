const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// One stored artifact — a device backup (.backup) or a config export (.rsc) —
// belonging to a Mikrotik management record. The file itself lives in S3 (or a
// private local dir); this document is its metadata + storage pointer. Retention
// prunes to the schedule's keepLast per (mikrotik, type).
const mikrotikArtifactSchema = new Schema(
  {
    mikrotik: {
      type: Schema.Types.ObjectId,
      ref: "Mikrotik",
      required: true,
    },
    type: {
      type: String,
      enum: ["backup", "export"],
      required: true,
    },
    // How the artifact was created.
    trigger: {
      type: String,
      enum: ["manual", "scheduled"],
      default: "manual",
    },
    // Flat, server-generated storage key ("<uuid>.backup" / "<uuid>.rsc").
    storageKey: {
      type: String,
      required: true,
    },
    // Human-friendly download name, e.g. "<identity>-2026-07-07-1430.backup".
    fileName: {
      type: String,
      required: true,
    },
    size: Number,
    // sha256 of the normalized export (comment/timestamp header stripped) — lets the
    // exporter detect running-config changes between successive .rsc exports.
    contentHash: String,
    // Where the file landed (S3 when configured, otherwise a private local dir).
    storage: {
      type: String,
      enum: ["s3", "local"],
      required: true,
    },
    // RouterOS version captured at creation (from the record's polled firmware).
    routerOsVersion: String,
    // The operator who triggered a manual artifact (unset for scheduled runs).
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

// Listing + retention pruning: newest-first within a device and artifact type.
mikrotikArtifactSchema.index({ mikrotik: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("MikrotikArtifact", mikrotikArtifactSchema);
