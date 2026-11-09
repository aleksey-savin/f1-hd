const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTaxiPresence, shouldApplyPresence, moneyToMinor } = require('./policy');

test('taxi presence is recognized only by its source and trip', () => {
  assert.equal(isTaxiPresence({ workStatus: { code: 'trip', source: 'taxi', taxiTripId: 'abc' } }), true);
  assert.equal(isTaxiPresence({ workStatus: { code: 'trip', source: 'manual' } }), false);
});
test('home, unknown and historical trips never cause presence', () => {
  for (const trip of [{ purpose: 'home' }, { purpose: 'unknown' }, { historical: true }]) {
    assert.equal(shouldApplyPresence({ purpose: 'business', status: 'transporting', userId: 'u', ...trip }), false);
  }
  assert.equal(shouldApplyPresence({ purpose: 'business', status: 'transporting', userId: 'u' }), true);
});
test('decimal amounts become exact integer minor units', () => {
  assert.equal(moneyToMinor('120.05'), 12005);
  assert.throws(() => moneyToMinor('10.001'));
  assert.throws(() => moneyToMinor('NaN'));
});

test('work links require an actual on-site visit, matching company and ownership', () => {
  const { validateWorkTrip } = require('./policy');
  const work = { company: 'c', visitRequired: true, finishedAt: new Date(), finishedBy: { _id: 'u' } };
  const trip = { companyId: 'c', userId: 'u', purpose: 'business' };
  assert.doesNotThrow(() => validateWorkTrip(work, trip, { userId: 'u', canAllocate: false }));
  assert.throws(() => validateWorkTrip({ ...work, visitRequired: false }, trip, { userId: 'u' }));
  assert.throws(() => validateWorkTrip(work, { ...trip, purpose: 'home' }, { userId: 'u' }));
  assert.throws(() => validateWorkTrip(work, { ...trip, companyId: 'other' }, { userId: 'u' }));
  assert.throws(() => validateWorkTrip(work, { ...trip, userId: 'other' }, { userId: 'u' }));
});

test('company purpose uses configured company IDs and personal is never a client departure', () => {
  const { companyPurpose, normalizePurpose } = require('./policy');
  assert.equal(companyPurpose('internal', 'internal'), 'service');
  assert.equal(companyPurpose('client', 'internal'), 'business');
  assert.equal(companyPurpose(null, 'internal'), 'unknown');
  assert.equal(normalizePurpose('home'), 'personal');
  for (const purpose of ['personal', 'service', 'unknown']) assert.equal(shouldApplyPresence({ purpose, status: 'transporting', userId: 'u' }), false);
  assert.equal(shouldApplyPresence({ purpose: 'business', status: 'transporting', userId: 'u', deletedAt: new Date() }), false);
});
