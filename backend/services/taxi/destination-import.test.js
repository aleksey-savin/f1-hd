require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const stub = (path, exports) => { const filename = require.resolve(path); const item = new Module(filename); Object.assign(item, { filename, loaded: true, exports }); require.cache[filename] = item; };
const query = (value) => ({ select() { return this; }, lean: async () => value });
const company = { _id: 'company', address: 'Шилкинская, 32а', location: { lat: 43.12, lon: 131.92 } };
const other = { _id: 'other', alias: 'Другой клиент', address: 'Строителей, 7', location: { lat: 44, lon: 132 } };
const user = { _id: 'employee', workStatus: {} };
const trips = new Map(); let catalogueReads = 0; let linkedWork = false;
stub('../../models/taxi', { TaxiSettings: {}, TaxiEmployee: { findOne: () => query({ userId: 'employee' }) }, TaxiTrip: {
  updateOne: async (filter, change, options) => {
    let trip = trips.get(filter.externalId);
    if (!trip && options?.upsert) { trip = { _id: filter.externalId, companyId: null, purpose: 'unknown', ticketIds: [], ...change.$setOnInsert }; trips.set(filter.externalId, trip); }
    if (trip && sift(filter)(trip)) Object.assign(trip, change.$set);
  },
  findOne: (filter) => query(trips.get(filter.externalId)),
} });
stub('../../models/company', { find: () => { catalogueReads++; return query([company, other]); }, findById: (id) => query(id === 'other' ? other : company) });
stub('../../models/subdivision', { find: () => query([{ company: 'company', address: 'Океанский проспект, 5', location: { lat: 43.15, lon: 131.89 } }]) });
stub('../../models/user', { findById: async () => null, updateOne: async (filter, change) => { if (sift(filter)(user)) user.workStatus.note = change.$set['workStatus.note']; } }); stub('../../models/ticket', { Ticket: {} }); stub('../../models/preferences', {}); stub('../../models/notification', { updateOne: () => assert.fail('attribute refresh must not announce another departure') });
stub('../../models/work', { exists: async () => linkedWork });
const { createStore } = require('./sync');
const { shouldApplyPresence } = require('./policy');
const parsed = (externalId, changes = {}) => ({ externalId, externalUserId: 'external-user', status: 'transporting', purpose: 'unknown', destination: { address: 'Шилкинская, 32а', lat: 43.1201, lon: 131.92 }, ...changes });
test('Go destination assigns the company and business purpose without any custom Yandex fields', async () => {
  const store = createStore({ clientId: 'corp' }, 'lease');
  const trip = await store.saveTrip(parsed('new'), {});
  assert.equal(String(trip.companyId), 'company');
  assert.equal(trip.purpose, 'business');
  assert.equal(shouldApplyPresence(trip), true);
  const branch = await store.saveTrip(parsed('branch', { destination: { address: 'Океанский проспект, 5' } }), {});
  assert.equal(String(branch.companyId), 'company');
  assert.equal(catalogueReads, 1, 'company/subdivision catalogue is loaded once per sync');
});
test('home intent, manual allocation and a different destination cannot become automatic service visits', async () => {
  const store = createStore({ clientId: 'corp' }, 'lease');
  const home = await store.saveTrip(parsed('home', { purpose: 'home' }), {});
  assert.equal(home.purpose, 'personal'); assert.equal(shouldApplyPresence(home), false);
  const replay = await store.saveTrip(parsed('home'), {});
  assert.equal(replay.purpose, 'personal');
  trips.set('manual', { _id: 'manual', clientId: 'corp', externalId: 'manual', companyId: 'manual-company', manuallyAssigned: true, purpose: 'home' });
  const manual = await store.saveTrip(parsed('manual'), {});
  assert.equal(manual.companyId, 'manual-company'); assert.equal(manual.purpose, 'home');
  const different = await store.saveTrip(parsed('different', { destination: { address: 'Шилкинская, 34', lat: 43.1201, lon: 131.92 } }), {});
  assert.equal(different.companyId, null); assert.equal(shouldApplyPresence(different), false);
});
test('a completed imported ride can obtain its destination from the later financial report', async () => {
  const store = createStore({ clientId: 'corp' }, 'lease');
  await store.saveTrip(parsed('finance', { status: 'complete', destination: undefined }), {});
  await store.saveFinance('finance', { totalMinor: 20000, destination: { address: 'Шилкинская, 32а' } });
  assert.equal(String(trips.get('finance').companyId), 'company');
  assert.equal(trips.get('finance').purpose, 'business');
  assert.equal(shouldApplyPresence(trips.get('finance')), false);
});
test('a changed destination rechecks automatic attribution while an actual work link wins', async () => {
  const store = createStore({ clientId: 'corp' }, 'lease');
  await store.saveTrip(parsed('rerouted', { status: 'searching' }), {});
  const moved = await store.saveTrip(parsed('rerouted', { destination: { address: 'Другой адрес, 5', lat: 44, lon: 132 } }), {});
  assert.equal(moved.companyId, null);
  assert.equal(moved.purpose, 'unknown');
  await store.saveTrip(parsed('work-linked'), {});
  linkedWork = true;
  const locked = await store.saveTrip(parsed('work-linked', { destination: { address: 'Другой адрес, 5', lat: 44, lon: 132 } }), {});
  assert.equal(String(locked.companyId), 'company');
  linkedWork = false;
});
test('a later reroute refreshes the taxi-owned presence note without restoring a manual status or announcing again', async () => {
  const store = createStore({ clientId: 'corp' }, 'lease');
  await store.saveTrip(parsed('late-reroute'), {});
  trips.get('late-reroute').presenceAppliedAt = new Date(Date.now() - 20 * 60000);
  user.workStatus = { source: 'taxi', taxiTripId: 'late-reroute', note: 'Первый адрес' };
  const next = parsed('late-reroute', { destination: { address: 'Строителей, 7', lat: 44, lon: 132 } });
  await store.saveTrip(next, {});
  assert.equal(user.workStatus.note, 'Другой клиент · Строителей, 7');
  user.workStatus = { source: 'manual', note: 'Ручная заметка' };
  await store.saveTrip(parsed('late-reroute'), {});
  assert.equal(user.workStatus.note, 'Ручная заметка');
});

test('the configured own company is service rather than a client departure', async () => {
  const trip = await createStore({ clientId: 'corp', internalCompanyId: 'company' }, 'lease').saveTrip(parsed('internal-service'), {});
  assert.equal(String(trip.companyId), 'company');
  assert.equal(trip.purpose, 'service');
  assert.equal(shouldApplyPresence(trip), false);
});

test('provider replay and later finance cannot revive or reattribute a deleted trip', async () => {
  const deletedAt = new Date();
  trips.set('deleted', { _id: 'deleted', clientId: 'corp', externalId: 'deleted', companyId: null, purpose: 'personal', deletedAt, deletedBy: 'allocator', ticketIds: [] });
  const before = trips.size;
  const store = createStore({ clientId: 'corp' }, 'lease');
  const trip = await store.saveTrip(parsed('deleted'), {});
  await store.saveFinance('deleted', { totalMinor: 10000 });
  assert.equal(trips.size, before);
  assert.equal(trip.deletedAt, deletedAt);
  assert.equal(trip.deletedBy, 'allocator');
  assert.equal(trip.companyId, null);
  assert.equal(trip.totalMinor, undefined);
});
