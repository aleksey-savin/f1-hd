require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const stub = (path, exports) => {
  const filename = require.resolve(path);
  const entry = new Module(filename);
  Object.assign(entry, { filename, loaded: true, exports });
  require.cache[filename] = entry;
};
const trip = { _id: 'trip', userId: 'user', purpose: 'business', status: 'transporting', companyId: 'company', destination: { address: 'Шилкинская, 32а' }, presenceAppliedAt: null, announcementClaimedAt: null };
const user = { _id: 'user', isEndUser: false, firstName: 'Максим', lastName: 'Гурьянов', workStatus: { updatedAt: new Date('2026-01-01') } };
const notifications = new Map();
const query = (value) => ({ lean: async () => value, select() { return this; } });
stub('../../models/taxi', {
  TaxiSettings: {}, TaxiEmployee: {},
  TaxiTrip: {
    findOneAndUpdate: (_filter, update) => {
      if (trip.presenceAppliedAt) return query(null);
      Object.assign(trip, update.$set);
      return query({ ...trip });
    },
    findById: () => query({ ...trip }),
    updateOne: async (_filter, update) => { Object.assign(trip, update.$set); },
  },
});
stub('../../models/user', {
  findById: () => query(user),
  updateOne: async (filter, update) => {
    const at = filter.$or?.[0]?.['workStatus.updatedAt']?.$lte;
    const own = user.workStatus.source === 'taxi' && user.workStatus.taxiTripId === trip._id;
    if (own || !user.workStatus.updatedAt || user.workStatus.updatedAt <= at) {
      user.workStatus = update.$set.workStatus;
      return { matchedCount: 1 };
    }
    return { matchedCount: 0 };
  },
});
stub('../../models/company', { findById: () => query({ alias: 'Автогарант' }) });
stub('../../models/ticket', { Ticket: {} });
stub('../../models/preferences', { findOne: () => query({ notify: { byTelegram: { isActive: true, sendToGroup: true, chatId: '-100' } } }) });
stub('../../models/notification', { updateOne: async (filter, update) => { if (!notifications.has(filter._id)) notifications.set(filter._id, update.$setOnInsert); } });
const { createStore } = require('./sync');

test('a start creates one group outbox entry and never restores a later manual status', async () => {
  const store = createStore({ clientId: 'corp', token: 'cipher' }, 'lease');
  const start = new Date('2026-11-09T00:00:00Z');
  await store.live({ ...trip }, start);
  assert.equal(user.workStatus.source, 'taxi');
  assert.equal(user.workStatus.note, 'Автогарант · Шилкинская, 32а');
  assert.equal(notifications.size, 1);
  assert.equal(notifications.get('trip').text, '🚕 Максим Гурьянов на выезде, компания Автогарант, адрес Шилкинская, 32а');
  user.workStatus = { source: 'manual', code: 'office', updatedAt: new Date('2026-11-09T00:01:00Z') };
  await store.live({ ...trip }, new Date('2026-11-09T00:02:00Z'));
  assert.equal(user.workStatus.code, 'office');
  assert.equal(notifications.size, 1);
});

test('days-late crash recovery consumes an old announcement without announcing a current departure', async () => {
  notifications.clear();
  trip.presenceAppliedAt = new Date('2026-11-07T00:00:00Z');
  trip.announcementClaimedAt = null;
  trip.status = 'finished';
  user.workStatus = { source: 'manual', code: 'office', updatedAt: new Date('2026-11-08T00:00:00Z') };
  const store = createStore({ clientId: 'corp', token: 'cipher' }, 'lease');
  await store.live({ ...trip }, new Date('2026-11-09T00:00:00Z'));
  assert.equal(notifications.size, 0);
  assert.equal(user.workStatus.code, 'office');
  assert.ok(trip.announcementClaimedAt);
});

test('generated presence and departure messages use compact addresses before note truncation', async () => {
  notifications.clear();
  Object.assign(trip, { status: 'transporting', presenceAppliedAt: null, announcementClaimedAt: null, destination: { address: 'Россия, Приморский край, Владивосток, улица Нейбута, 33А' } });
  user.workStatus = { source: 'manual', code: 'office', updatedAt: new Date('2026-11-08T00:00:00Z') };
  await createStore({ clientId: 'corp' }, 'lease').live({ ...trip }, new Date('2026-11-10T02:29:30Z'));
  assert.equal(user.workStatus.note, 'Автогарант · Владивосток, улица Нейбута, 33А');
  const message = notifications.get(trip._id).text;
  assert.match(message, /Владивосток, улица Нейбута, 33А/);
  assert.doesNotMatch(message, /Россия|Приморский край/);
});
