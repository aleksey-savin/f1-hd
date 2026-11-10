const mongoose = require('mongoose');
const { Schema } = mongoose;
// Authenticated webhook inbox. A 200 means durable receipt, never merely queued in RAM.
const schema = new Schema({
  _id: { type: String },
  kind: { type: String, enum: ['messages', 'statuses', 'channelsUpdates'], required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  attempts: { type: Number, default: 0 },
  notBefore: { type: Date, default: Date.now },
  leaseUntil: { type: Date, default: null },
  processedAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
}, { timestamps: true });
schema.index({ processedAt: 1, notBefore: 1, leaseUntil: 1, createdAt: 1 });
schema.index({ processedAt: 1 }, { expireAfterSeconds: 7 * 86400, partialFilterExpression: { processedAt: { $type: 'date' } } });
module.exports = mongoose.model('WazzupEvent', schema);
