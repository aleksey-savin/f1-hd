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
const lean = (value) => ({ lean: async () => value });
const existing = { _id: 'trip', externalId: 'ext', clientId: 'corp', source: 'go', purpose: 'business', companyId: 'manual-company', ticketIds: ['manual-ticket'], manuallyAssigned: true };
stub('../../models/taxi', {
  TaxiSettings: {}, TaxiEmployee: { findOne: () => lean(null) },
  TaxiTrip: {
    updateOne: async (filter, update) => {
      if (filter.manuallyAssigned && existing.manuallyAssigned) return;
      if (update.$setOnInsert) assert.equal('externalId' in update.$set, false);
      Object.assign(existing, update.$set);
    },
    findOne: () => lean(existing),
  },
});
stub('../../models/user', {});
stub('../../models/company', {});
stub('../../models/preferences', {});
stub('../../models/notification', {});
const { createStore } = require('./sync');

test('provider import preserves manually assigned company, tickets and purpose', async () => {
  const store = createStore({ clientId: 'corp', token: 'cipher' }, 'lease');
  const row = { externalId: 'ext', externalUserId: 'user', status: 'complete', purpose: 'home' };
  await store.saveTrip(row);
  assert.equal(existing.companyId, 'manual-company');
  assert.deepEqual(existing.ticketIds, ['manual-ticket']);
  assert.equal(existing.purpose, 'business');
  assert.equal(existing.status, 'complete');
});
