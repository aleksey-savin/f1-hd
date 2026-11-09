const mongoose = require('mongoose');
const { toCanonicalPhone } = require('../services/phone');
const { Schema } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name, default: null });
const location = new Schema({ address: String, lat: Number, lon: Number }, { _id: false });
const settingsSchema = new Schema({
  _id: { type: String, default: 'yandex-business' },
  isActive: { type: Boolean, default: false },
  token: { type: String, select: false },
  clientId: String,
  pollSeconds: { type: Number, default: 60 },
  historyDays: { type: Number, default: 14 },
  health: { lastOkAt: Date, lastErrorAt: Date, lastError: String, financialPending: Boolean, financialError: String, consecutiveFailures: { type: Number, default: 0 } },
  lastSyncAt: Date,
  leaseUntil: Date,
  leaseToken: String,
}, { timestamps: true });
const employeeSchema = new Schema({
  externalId: { type: String, required: true, unique: true },
  userId: ref('User'), firstName: String, lastName: String, fullName: String, email: String, nickname: String,
  phone: { type: String, set: toCanonicalPhone },
  active: { type: Boolean, default: true },
}, { timestamps: true });
employeeSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });
const tripSchema = new Schema({
  externalId: { type: String, required: true }, clientId: { type: String, required: true },
  source: { type: String, enum: ['hd', 'go'], required: true }, userId: ref('User'),
  externalUserId: String, companyId: ref('Company'), ticketIds: [{ type: Schema.Types.ObjectId, ref: 'Ticket' }],
  companyMatch: { type: String, enum: ['address', 'coordinates'], default: null },
  // Keep the historical purpose value; readers display it as personal.
  purpose: { type: String, enum: ['business', 'service', 'personal', 'home', 'unknown'], default: 'unknown' },
  deletedAt: { type: Date, default: null }, deletedBy: ref('User'),
  status: String, origin: location, destination: location, requestedAt: Date, startedAt: Date, finishedAt: Date,
  estimateMinor: Number, totalMinor: Number, currency: String,
  driver: { name: String, phone: String, car: String, number: String },
  lastSyncedAt: Date, financialPending: { type: Boolean, default: true }, manuallyAssigned: { type: Boolean, default: false }, presenceAppliedAt: Date,
  announcementClaimedAt: Date,
}, { timestamps: true });
tripSchema.index({ clientId: 1, externalId: 1 }, { unique: true });
module.exports = {
  TaxiSettings: mongoose.model('TaxiSettings', settingsSchema),
  TaxiEmployee: mongoose.model('TaxiEmployee', employeeSchema),
  TaxiTrip: mongoose.model('TaxiTrip', tripSchema),
};
