require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const set = require('lodash/set');
const stub = (path, exports) => { const filename = require.resolve(path); const entry = new Module(filename); Object.assign(entry, { filename, loaded: true, exports }); require.cache[filename] = entry; };
stub('../models/ticket', { Ticket: {} });
stub('../utils/logger', { log() {}, info() {}, warn() {}, error() {} });
process.env.APP_ENC_KEY = Buffer.alloc(32, 9).toString('base64');
const Preferences = require('../models/preferences');
const WazzupSettings = require('../models/wazzupSettings');
const configuration = require('../services/wazzup/configuration');
const controller = require('./preferences');
const checkController = require('./wazzupSettings');
const provider = require('../services/wazzup/provider');
const { encryptSecret } = require('../services/crypto/secretBox');
const auth = (...permissions) => ({ isEndUser: false, can: (request) => Object.entries(request).every(([resource, actions]) => actions.every((action) => permissions.includes(`${resource}.${action}`))) });
const invoke = async (handler, permissions, body) => {
  let error, result;
  await handler({ auth: permissions, body }, { status() { return this; }, json(value) { result = value; } }, (value) => { error = value; });
  return { error, result };
};
const fixture = (t) => {
  const preferences = new Preferences({ timezone: 'Asia/Vladivostok' });
  let saves = 0;
  t.mock.method(Preferences, 'findOne', async () => preferences);
  t.mock.method(preferences, 'save', async () => { saves++; return preferences; });
  const stored = { isActive: false, apiKey: encryptSecret('saved-private-key'), health: { lastError: 'working health', lastErrorHint: 'old hint', lastMessageAt: new Date('2026-11-01T00:00:00Z') }, channelIds: [] };
  const healthWrites = [];
  t.mock.method(WazzupSettings, 'findById', () => ({ select() { return this; }, lean: async () => structuredClone(stored) }));
  t.mock.method(WazzupSettings, 'updateOne', async (filter, update) => {
    healthWrites.push({ filter, update });
    if (filter.apiKey === stored.apiKey) for (const [path, value] of Object.entries(update.$set || {})) set(stored, path, value);
  });
  return { preferences, stored, healthWrites, get saves() { return saves; } };
};
test('settings managers receive masked Wazzup configuration while restricted staff do not', async (t) => {
  fixture(t);
  const { result, error } = await invoke(controller.get, auth('settings.manage'));
  assert.equal(error, undefined);
  assert.equal(result.wazzup.apiKeyIsSet, true);
  assert.equal('apiKey' in result.wazzup, false);
  assert.equal((await invoke(controller.get, auth('conversation.manage'))).error.statusCode, 403);
});
test('Wazzup permission denial and invalid draft stop unrelated preference mutation', async (t) => {
  const state = fixture(t);
  assert.equal((await invoke(controller.update, auth('conversation.manage'), { wazzup: { isActive: false } })).error.statusCode, 403);
  const result = await invoke(controller.update, auth('settings.manage'), { timezone: 'UTC', wazzup: { channelIds: [null] } });
  assert.equal(result.error.statusCode, 422);
  assert.equal(state.preferences.timezone, 'Asia/Vladivostok');
  assert.equal(state.saves, 0);
});
test('Wazzup-only save does not rewrite general preferences', async (t) => {
  const state = fixture(t);
  t.mock.method(configuration, 'saveConfiguration', async () => ({}));
  const result = await invoke(controller.update, auth('settings.manage'), { wazzup: { isActive: false } });
  assert.equal(result.error, undefined);
  assert.equal(state.saves, 0);
  assert.equal(result.result.preferences.wazzup.apiKeyIsSet, true);
});
test('check uses the saved key for a blank draft and records successful health without rewriting settings', async (t) => {
  const state = fixture(t);
  t.mock.method(WazzupSettings, 'findOneAndUpdate', () => assert.fail('checking a draft must not persist configuration'));
  t.mock.method(provider, 'fetchAccounts', async (key) => { assert.equal(key, 'saved-private-key'); return [{ id: 'tg1', type: 'telegram' }]; });
  const result = await invoke(checkController.check, auth('settings.manage'), { apiKey: '' });
  assert.equal(result.error, undefined);
  assert.equal(result.result.accounts[0].id, 'tg1');
  assert.equal(state.saves, 0);
  assert.equal(state.healthWrites.length, 1);
  assert.equal(state.healthWrites[0].filter.apiKey, state.stored.apiKey);
  assert.equal(state.stored.health.lastError, '');
  assert.equal(state.stored.health.lastErrorHint, '');
  assert.equal(state.stored.health.lastErrorAt, null);
  assert.ok(state.stored.health.lastCheckedAt instanceof Date);
  assert.deepEqual(state.stored.health.lastOkAt, state.stored.health.lastCheckedAt);
  assert.deepEqual(state.stored.health.lastMessageAt, new Date('2026-11-01T00:00:00Z'));
});
test('check rejects unauthorized callers and returns only safe failure details', async (t) => {
  const state = fixture(t);
  assert.equal((await invoke(checkController.check, auth('conversation.manage'), { apiKey: 'draft' })).error.statusCode, 403);
  t.mock.method(provider, 'fetchAccounts', async () => { throw new Error('Authorization: Bearer secret'); });
  const result = await invoke(checkController.check, auth('settings.manage'), { apiKey: '' });
  assert.equal(result.error.statusCode, 502);
  assert.equal(JSON.stringify(result.error).includes('Bearer secret'), false);
  assert.equal(state.healthWrites.length, 0);
  assert.equal(state.stored.health.lastError, 'working health');
});


test('check records positive health when an explicit API key equals the saved one', async (t) => {
  const state = fixture(t);
  t.mock.method(provider, 'fetchAccounts', async () => []);
  const result = await invoke(checkController.check, auth('settings.manage'), { apiKey: 'saved-private-key' });
  assert.equal(result.error, undefined);
  assert.equal(state.healthWrites.length, 1);
  assert.ok(state.stored.health.lastOkAt instanceof Date);
});

test('successful check of another draft key leaves saved health untouched', async (t) => {
  const state = fixture(t);
  t.mock.method(provider, 'fetchAccounts', async () => []);
  const result = await invoke(checkController.check, auth('settings.manage'), { apiKey: 'another-draft-key' });
  assert.equal(result.error, undefined);
  assert.equal(state.healthWrites.length, 0);
  assert.equal(state.stored.health.lastError, 'working health');
  assert.equal(state.stored.health.lastOkAt, undefined);
});


test('successful in-flight check does not mark a replacement API key healthy', async (t) => {
  const state = fixture(t);
  t.mock.method(provider, 'fetchAccounts', async () => {
    state.stored.apiKey = encryptSecret('replacement-key');
    return [];
  });
  const result = await invoke(checkController.check, auth('settings.manage'), { apiKey: '' });
  assert.equal(result.error, undefined);
  assert.equal(state.healthWrites.length, 0);
  assert.equal(state.stored.health.lastError, 'working health');
});

test('Wazzup metadata read independently rejects unauthorized staff and clients', async (t) => {
  fixture(t);
  t.mock.method(WazzupSettings, 'findById', () => assert.fail('denied read must not access saved configuration'));
  for (const permissions of [undefined, auth('conversation.manage'), { ...auth('settings.manage'), isEndUser: true }]) {
    const result = await invoke(checkController.get, permissions);
    assert.equal(result.error.statusCode, 403);
    assert.equal(result.result, undefined);
  }
});

test('Wazzup metadata read returns current public configuration without secrets or writes', async (t) => {
  const state = fixture(t);
  state.stored.webhookToken = encryptSecret('private-callback-token');
  state.stored.accounts = [{ id: 'remote-1', type: 'telegram', name: 'Support', account: '@support', transport: 'telegram', state: 'active', reason: 'Подключён' }];
  const result = await invoke(checkController.get, auth('settings.manage'));
  assert.equal(result.error, undefined);
  assert.deepEqual(Object.keys(result.result), ['wazzup']);
  assert.equal(result.result.wazzup.apiKeyIsSet, true);
  assert.deepEqual(result.result.wazzup.accounts, state.stored.accounts);
  assert.equal(result.result.wazzup.health.lastError, 'working health');
  assert.equal('apiKey' in result.result.wazzup, false);
  assert.equal('webhookToken' in result.result.wazzup, false);
  assert.equal(JSON.stringify(result.result).includes('private'), false);
  assert.equal(JSON.stringify(result.result).includes(state.stored.apiKey), false);
  assert.equal(JSON.stringify(result.result).includes(state.stored.webhookToken), false);
  assert.equal(state.healthWrites.length, 0);
  assert.equal(state.saves, 0);
});

test('Wazzup metadata GET route requires authentication and settings management', () => {
  const router = require('../routes/internal/preferences');
  const isAuth = require('../middleware/isAuth');
  const { canManageSettings } = require('../middleware/permissions');
  const route = (router._router || router.router || router).stack.find((layer) => layer.route?.path === '/preferences/wazzup' && layer.route.methods.get)?.route;
  assert.ok(route);
  assert.deepEqual(route.stack.map((layer) => layer.handle), [isAuth, canManageSettings, checkController.get].flat(Infinity));
});
