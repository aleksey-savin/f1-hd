require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gatewayFilter, providerOf } = require('./transport');
test('gateway filtering includes legacy unset provider but excludes all Wazzup channels/jobs', () => {
  const sift = require('sift').default;
  const direct = { _id: 'direct', provider: 'gateway' };
  const legacy = { _id: 'legacy' };
  const wazzup = { _id: 'wazzup', provider: 'wazzup' };
  assert.deepEqual([direct, legacy, wazzup].filter(sift(gatewayFilter())).map(row => row._id), ['direct', 'legacy']);
  assert.equal(providerOf(legacy), 'gateway');
  assert.equal(providerOf(wazzup), 'wazzup');
});
