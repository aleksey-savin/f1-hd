const mongoose = require("mongoose");

// Request receipts survive key rotations, process restarts and target deletion.
// Keep a digest of the input rather than a second copy of ticket text.
const schema = new mongoose.Schema({
  _id: String,
  digest: { type: String, required: true },
  record: { type: mongoose.Schema.Types.ObjectId, required: true },
  tickets: [mongoose.Schema.Types.ObjectId],
  revision: Date,
  resultNum: Number,
  resultVersion: Number,
  deletionClaimed: Boolean,
  fileNames: { type: [String], default: undefined },
  applied: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("McpTicketWrite", schema);
