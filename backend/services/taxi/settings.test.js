const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.APP_ENC_KEY = Buffer.alloc(32, 4).toString('base64');
const { encryptSecret } = require('../crypto/secretBox');
const { prepareSettings, publicSettings } = require('./settings');
test('settings keep encrypted token when submitted blank and never expose it', () => {
  const encrypted = encryptSecret('secret');
  const next = prepareSettings({ clientId: 'corp', token: '', isActive: true }, { token: encrypted });
  assert.equal(next.token, encrypted);
  const output = publicSettings(next);
  assert.equal(output.tokenIsSet, true);
  assert.equal('token' in output, false);
});
test('enabled settings require credentials and bounded polling intervals', () => {
  assert.throws(() => prepareSettings({ isActive: true }, {}));
  assert.throws(() => prepareSettings({ pollSeconds: 1 }, {}));
  assert.throws(() => prepareSettings({ historyDays: 10000 }, {}));
});
test('retired corporate questions are excluded from saved and public settings', () => {
  const legacy = { purposeCostCenterId: 'purpose', companyCostCenterId: 'company', ticketCostCenterId: 'ticket' };
  const next = prepareSettings({ ...legacy, clientId: 'corp' }, legacy);
  for (const key of Object.keys(legacy)) {
    assert.equal(key in next, false);
    assert.equal(key in publicSettings(legacy), false);
  }
});
