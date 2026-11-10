require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const stub = (path, exports) => { const filename = require.resolve(path); const entry = new Module(filename); Object.assign(entry, { filename, loaded: true, exports }); require.cache[filename] = entry; };
stub('../models/ticket', { Ticket: {} });
stub('../utils/logger', { log() {}, info() {}, warn() {}, error() {} });
const Preferences = require('../models/preferences');
const { TaxiSettings, TaxiEmployee } = require('../models/taxi');
const User = require('../models/user');
const controller = require('./preferences');
const { encryptSecret } = require('../services/crypto/secretBox');
process.env.APP_ENC_KEY = Buffer.alloc(32, 3).toString('base64');
const auth = (...permissions) => ({ userId: 'staff', isEndUser: false, can: (request) => Object.entries(request).every(([resource, actions]) => actions.every((action) => permissions.includes(`${resource}.${action}`))) });
const invoke = async (handler, permissions, body) => {
  let error, result;
  await handler({ auth: permissions, body }, { status() { return this; }, json(value) { result = value; } }, (value) => { error = value; });
  return { error, result };
};
const query = (value) => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
const fixture = (t) => {
  const preferences = new Preferences({ timezone: 'Asia/Vladivostok', notify: { byTelegram: { token: 'private-global-secret' } } });
  const settings = { isActive: true, clientId: 'corp', token: encryptSecret('private-corporate-secret'), health: { consecutiveFailures: 4 }, leaseToken: 'private-lease' };
  const writes = { general: 0, taxi: 0 };
  t.mock.method(Preferences, 'findOne', async () => preferences);
  t.mock.method(preferences, 'save', async () => { writes.general++; return preferences; });
  t.mock.method(TaxiSettings, 'findById', () => query(settings));
  t.mock.method(TaxiEmployee, 'find', () => query([{ externalId: 'external' }]));
  t.mock.method(User, 'find', () => query([{ _id: 'staff', firstName: 'Максим' }]));
  t.mock.method(TaxiSettings, 'findOneAndUpdate', (_filter, update) => { writes.taxi++; Object.assign(settings, update.$set); return query(settings); });
  return { preferences, settings, writes };
};
test('taxi configurator can read only taxi settings and mappings through global preferences', async (t) => {
  fixture(t);
  const { error, result } = await invoke(controller.get, auth('taxi.configure'));
  assert.equal(error, undefined);
  assert.deepEqual(Object.keys(result), ['taxiBusiness']);
  assert.equal(result.taxiBusiness.settings.clientId, 'corp');
  assert.equal(result.taxiBusiness.settings.tokenIsSet, true);
  assert.equal(result.taxiBusiness.employees[0].externalId, 'external');
  assert.equal(result.taxiBusiness.users[0].firstName, 'Максим');
  assert.equal(JSON.stringify(result).includes('private-'), false);
});
test('general settings privilege does not expose corporate configuration', async (t) => {
  fixture(t);
  const { result, error } = await invoke(controller.get, auth('settings.manage'));
  assert.equal(error, undefined);
  assert.equal(result.timezone, 'Asia/Vladivostok');
  assert.equal('taxiBusiness' in result, false);
});
test('global taxi draft saves only allowed settings and preserves the blank encrypted token and health', async (t) => {
  const { settings, writes } = fixture(t);
  const token = settings.token;
  const { result, error } = await invoke(controller.update, auth('taxi.configure'), { taxiBusiness: { token: '', pollSeconds: 120, health: { consecutiveFailures: 0 }, leaseToken: 'injected' } });
  assert.equal(error, undefined);
  assert.equal(writes.taxi, 1); assert.equal(writes.general, 0);
  assert.equal(settings.token, token); assert.equal(settings.pollSeconds, 120);
  assert.equal(settings.health.consecutiveFailures, 4); assert.equal(settings.leaseToken, 'private-lease');
  assert.deepEqual(Object.keys(result.preferences), ['taxiBusiness']);
  assert.equal(JSON.stringify(result).includes(token), false);
});
test('taxi configurators cannot edit general settings and settings managers cannot edit corporate settings', async (t) => {
  const { writes } = fixture(t);
  for (const [permissions, body] of [
    [auth('taxi.configure'), { timezone: 'UTC', taxiBusiness: { pollSeconds: 120 } }],
    [auth('settings.manage'), { taxiBusiness: { pollSeconds: 120 } }],
    [auth('taxi.read'), { taxiBusiness: {} }],
  ]) {
    const { error } = await invoke(controller.update, permissions, body);
    assert.equal(error?.statusCode, 403);
  }
  assert.deepEqual(writes, { general: 0, taxi: 0 });
});
test('invalid taxi draft prevents general preference writes in a combined save', async (t) => {
  const { preferences, writes } = fixture(t);
  const { error } = await invoke(controller.update, auth('settings.manage', 'taxi.configure'), { timezone: 'UTC', taxiBusiness: { pollSeconds: 1 } });
  assert.equal(error?.statusCode, 400);
  assert.equal(preferences.timezone, 'Asia/Vladivostok');
  assert.deepEqual(writes, { general: 0, taxi: 0 });
});
test('clients and staff with neither settings permission cannot read global preferences', async (t) => {
  fixture(t);
  for (const permissions of [auth('taxi.read'), { ...auth('taxi.configure'), isEndUser: true }]) {
    assert.equal((await invoke(controller.get, permissions)).error?.statusCode, 403);
  }
});

// Public general preferences include the separate Wazzup singleton.
const WazzupSettings = require('../models/wazzupSettings');
require('node:test').beforeEach((t) => {
  t.mock.method(WazzupSettings, 'findById', () => ({ select() { return this; }, lean: async () => null }));
});
