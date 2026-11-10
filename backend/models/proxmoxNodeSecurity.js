const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  resourceId: { type: Schema.Types.ObjectId, ref: 'ProxmoxResource', required: true, unique: true },
  status: { type: String, enum: ['queued', 'checking', 'partial', 'error', 'unavailable'], default: 'queued' },
  requestedAt: Date,
  checkedAt: Date,
  lastError: String,
  report: Schema.Types.Mixed,
  leaseToken: { type: String, select: false },
  leaseUntil: { type: Date, select: false },
}, { timestamps: true });
schema.index({ status: 1, requestedAt: 1 });
const NodeSecurity = mongoose.model('ProxmoxNodeSecurity', schema);
const sources = new Schema({
  _id: String,
  data: { type: Schema.Types.Mixed, select: false },
  checkedAt: Date,
}, { timestamps: true });
const NodeSecuritySource = mongoose.model('ProxmoxNodeSecuritySource', sources);
module.exports = { NodeSecurity, NodeSecuritySource };
