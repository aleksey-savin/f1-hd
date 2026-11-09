require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const company = '64f1a2b3c4d5e6f708192a3c', ticketId = '64f1a2b3c4d5e6f708192a3d';
const stub = (path, exports) => { const filename = require.resolve(path); const item = new Module(filename); Object.assign(item, { filename, loaded: true, exports }); require.cache[filename] = item; };
const query = (value) => ({ lean: async () => value });
let trip;
stub('../../models/taxi', { TaxiSettings: {}, TaxiEmployee: { findOne: () => query(null) }, TaxiTrip: {
  updateOne: async (filter, change) => { if (sift(filter)(trip)) Object.assign(trip, change.$set); },
  findOne: () => query(trip),
} });
stub('../../models/user', {});
stub('../../models/company', {});
stub('../../models/preferences', {});
stub('../../models/notification', {});
const { createStore } = require('./sync');
test('Go questions cannot create HD associations and import preserves previously stored human links', async () => {
  const store = createStore({ clientId: 'corp', token: 'cipher', companyCostCenterId: 'company', ticketCostCenterId: 'ticket' }, 'lease');
  const parsed = { externalId: 'ext', externalUserId: 'external-user', purpose: 'unknown', status: 'complete' };
  const row = { cost_center_values: [{ id: 'company', value: company }, { id: 'ticket', value: '1242' }] };
  trip = { _id: 'trip', clientId: 'corp', externalId: 'ext', companyId: null, ticketIds: [], manuallyAssigned: false, source: 'go' };
  await store.saveTrip(parsed, row);
  assert.equal(trip.companyId, null);
  assert.deepEqual(trip.ticketIds, []);
  assert.equal(trip.purpose, 'unknown');
  Object.assign(trip, { source: 'hd', companyId: company, ticketIds: [ticketId], purpose: 'home' });
  await store.saveTrip(parsed, row);
  assert.equal(trip.companyId, company);
  assert.deepEqual(trip.ticketIds, [ticketId]);
  assert.equal(trip.source, 'hd');
  assert.equal(trip.purpose, 'personal');
});
