const mongoose = require('mongoose');
const { Schema } = mongoose;
const accountSchema = new Schema({
  id: { type: String, required: true },
  type: { type: String, enum: ['telegram', 'whatsapp', 'max'], required: true },
  transport: String,
  name: String,
  account: { type: String, default: '' },
  state: String,
  reason: String,
}, { _id: false });
const schema = new Schema({
  _id: { type: String, default: 'wazzup', enum: ['wazzup'] },
  isActive: { type: Boolean, default: false },
  apiKey: { type: String, select: false },
  webhookToken: { type: String, select: false },
  channelIds: { type: [String], default: [] },
  accounts: { type: [accountSchema], default: [] },
  webhookConnected: { type: Boolean, default: false },
  health: {
    lastCheckedAt: Date,
    lastOkAt: Date,
    lastMessageAt: Date,
    lastError: String,
    lastErrorHint: String,
    lastErrorAt: Date,
  },
}, { timestamps: true });
module.exports = mongoose.model('WazzupSettings', schema);
