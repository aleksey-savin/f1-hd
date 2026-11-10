require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const loggerPath = require.resolve('../../utils/logger');
const loggerStub = new Module(loggerPath);
Object.assign(loggerStub, { filename: loggerPath, loaded: true, exports: { log() {}, info() {}, warn() {}, error() {} } });
require.cache[loggerPath] = loggerStub;
process.env.APP_ENC_KEY = Buffer.alloc(32, 8).toString('base64');
process.env.APP_PUBLIC_URL = 'https://hd.example.org';
const { encryptSecret, decryptSecret } = require('../crypto/secretBox');
const WazzupSettings = require('../../models/wazzupSettings');
const Channel = require('../../models/channel');
const sift = require('sift').default;
const set = require('lodash/set');
const configuration = require('./configuration');
const provider = require('./provider');
const channels = require('./channels');
const account = { id: 'remote-1', type: 'telegram', transport: 'telegram', name: 'Поддержка', account: '@support', state: 'connected', reason: '' };
const query = (value) => ({ select() { return this; }, lean: async () => value });
const fixture = (t, initial = null) => {
  let stored = initial ? structuredClone(initial) : null;
  const writes = [];
  t.mock.method(Channel, 'find', () => query([]));
  t.mock.method(WazzupSettings, 'findById', () => query(stored ? structuredClone(stored) : null));
  t.mock.method(WazzupSettings, 'findOneAndUpdate', (_filter, update) => {
    writes.push(structuredClone(update));
    if (!stored) stored = { _id: 'wazzup', isActive: false, ...update.$setOnInsert };
    for (const [path, value] of Object.entries(update.$set || {})) set(stored, path, value);
    return query(structuredClone(stored));
  });
  t.mock.method(provider, 'fetchAccounts', async () => [structuredClone(account)]);
  t.mock.method(provider, 'getWebhooks', async () => ({ webhooksUri: '', subscriptions: {} }));
  t.mock.method(provider, 'setWebhooks', async (_key, payload) => {
    assert.equal(stored.isActive, initial?.isActive || false);
    const token = new URL(payload.webhooksUri).searchParams.get('token');
    assert.equal(decryptSecret(stored.webhookToken), token);
    assert.ok(Buffer.from(token, 'base64url').length >= 32);
    assert.deepEqual(payload.subscriptions, { messagesAndStatuses: true, channelsUpdates: true, contactsAndDealsCreation: false });
  });
  const synced = [];
  t.mock.method(channels, 'syncChannels', async (value) => synced.push(structuredClone(value)));
  return { get stored() { return stored; }, writes, synced };
};
test('disabled initial configuration needs no credentials and never exposes secret fields', async (t) => {
  fixture(t);
  const prepared = await configuration.prepareConfiguration({ isActive: false });
  const result = await configuration.saveConfiguration(prepared);
  assert.equal(result.isActive, false);
  assert.equal(result.apiKeyIsSet, false);
  assert.deepEqual(result.channelIds, []);
  assert.equal('apiKey' in result, false);
  assert.equal('webhookToken' in result, false);
});
test('activation verifies selected remote ids, encrypts credentials and persists callback token before subscription', async (t) => {
  const state = fixture(t);
  const prepared = await configuration.prepareConfiguration({ isActive: true, apiKey: 'private-api', channelIds: ['remote-1'] });
  assert.equal(state.writes.length, 0);
  const result = await configuration.saveConfiguration(prepared);
  assert.equal(state.stored.isActive, true);
  assert.equal(decryptSecret(state.stored.apiKey), 'private-api');
  assert.equal(result.webhookConnected, true);
  assert.deepEqual(result.accounts, [account]);
  assert.equal(state.synced.at(-1).isActive, true);
  assert.equal(JSON.stringify(result).includes('private-api'), false);
  assert.equal(JSON.stringify(result).includes(state.stored.webhookToken), false);
});
test('blank API key preserves ciphertext; server-owned fields cannot be replaced by a draft', async (t) => {
  const apiKey = encryptSecret('stored-key');
  const state = fixture(t, { apiKey, channelIds: ['remote-1'], accounts: [account], health: { lastError: 'old error' } });
  const prepared = await configuration.prepareConfiguration({ apiKey: ' ', health: { lastError: '' }, accounts: [], webhookToken: 'injected', webhookConnected: true });
  await configuration.saveConfiguration(prepared);
  assert.equal(state.stored.apiKey, apiKey);
  assert.equal(state.stored.health.lastError, 'old error');
  assert.deepEqual(state.stored.accounts, [account]);
  assert.notEqual(state.stored.webhookToken, 'injected');
});
test('malformed drafts and unknown selected ids fail before any write', async (t) => {
  const state = fixture(t);
  for (const draft of [null, [], { isActive: 'true' }, { isActive: null }, { channelIds: null }, { apiKey: 123 }, { channelIds: 'remote-1' }, { channelIds: [null] }, { isActive: true, apiKey: 'key', channelIds: ['unknown'] }]) {
    await assert.rejects(configuration.prepareConfiguration(draft), (error) => error.statusCode === 422);
  }
  assert.equal(state.writes.length, 0);
});
test('active integration requires at least one account and a public HTTPS server address', async (t) => {
  fixture(t);
  await assert.rejects(configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: [] }), (error) => error.statusCode === 422);
  const previousUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = 'http://localhost:3000';
  t.after(() => { process.env.APP_PUBLIC_URL = previousUrl; });
  await assert.rejects(configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] }), (error) => error.statusCode === 422);
});
test('foreign webhook callback is refused without changing configuration', async (t) => {
  const state = fixture(t);
  t.mock.method(provider, 'getWebhooks', async () => ({ webhooksUri: 'https://other.example.org/callback?token=private', subscriptions: {} }));
  const prepared = await configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] });
  await assert.rejects(configuration.saveConfiguration(prepared), (error) => error.statusCode === 409 && !error.message.includes('private'));
  assert.equal(state.stored?.isActive || false, false);
  assert.equal(state.synced.length, 0);
});
test('webhook registration failure cannot activate a new configuration or replace old credentials', async (t) => {
  const oldKey = encryptSecret('old-key');
  const state = fixture(t, { apiKey: oldKey, isActive: false, channelIds: [], health: { lastError: 'old error' } });
  t.mock.method(provider, 'setWebhooks', async () => { throw new Error('raw request private-api'); });
  const prepared = await configuration.prepareConfiguration({ isActive: true, apiKey: 'private-api', channelIds: ['remote-1'] });
  await assert.rejects(configuration.saveConfiguration(prepared), (error) => !error.message.includes('private-api'));
  assert.equal(state.stored.isActive, false);
  assert.equal(state.stored.apiKey, oldKey);
  assert.equal(state.stored.health.lastError, 'old error');
  assert.equal(state.stored.health.lastOkAt, undefined);
  assert.equal(state.synced.length, 0);
});
test('disabling preserves history and remote webhook while deactivating local channels', async (t) => {
  const state = fixture(t, { isActive: true, apiKey: encryptSecret('key'), webhookToken: encryptSecret('token'), channelIds: ['remote-1'], accounts: [account], webhookConnected: true });
  t.mock.method(provider, 'setWebhooks', async () => assert.fail('must not remove remote callback'));
  const prepared = await configuration.prepareConfiguration({ isActive: false });
  const result = await configuration.saveConfiguration(prepared);
  assert.equal(result.isActive, false);
  assert.deepEqual(result.channelIds, ['remote-1']);
  assert.equal(state.synced.at(-1).isActive, false);
  assert.equal(result.webhookConnected, true);
});

test('unknown webhook response cannot overwrite an integration', async (t) => {
  const state = fixture(t);
  t.mock.method(provider, 'getWebhooks', async () => ({}));
  const prepared = await configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] });
  await assert.rejects(configuration.saveConfiguration(prepared), (error) => error.statusCode === 502);
  assert.equal(state.writes.length, 0);
});

test('repeated saves keep the same callback and accept the existing HD subscription', async (t) => {
  const token = 'saved-callback-token';
  const state = fixture(t, { isActive: true, apiKey: encryptSecret('key'), webhookToken: encryptSecret(token), accounts: [account], channelIds: ['remote-1'], webhookConnected: true });
  const callbacks = [];
  t.mock.method(provider, 'getWebhooks', async () => ({ webhooksUri: `https://hd.example.org/api/wazzup/webhook?token=${token}`, subscriptions: {} }));
  t.mock.method(provider, 'setWebhooks', async (_key, body) => callbacks.push(body.webhooksUri));
  for (let index = 0; index < 2; index++) await configuration.saveConfiguration(await configuration.prepareConfiguration({ isActive: true, apiKey: '', channelIds: ['remote-1'] }));
  assert.deepEqual(callbacks, ['https://hd.example.org/api/wazzup/webhook?token=saved-callback-token', 'https://hd.example.org/api/wazzup/webhook?token=saved-callback-token']);
  assert.equal(decryptSecret(state.stored.webhookToken), token);
});

test('concurrent initial saves share one stored callback token', async (t) => {
  const state = fixture(t);
  const [first, second] = await Promise.all([configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] }), configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] })]);
  const callbacks = [];
  t.mock.method(provider, 'setWebhooks', async (_key, body) => {
    callbacks.push(body.webhooksUri);
    assert.equal(new URL(body.webhooksUri).searchParams.get('token'), decryptSecret(state.stored.webhookToken));
  });
  await Promise.all([configuration.saveConfiguration(first), configuration.saveConfiguration(second)]);
  assert.equal(callbacks.length, 2);
  assert.equal(callbacks[0], callbacks[1]);
});


test('activation refuses an account already active directly by canonical phone before any write', async (t) => {
  const state = fixture(t);
  t.mock.method(provider, 'fetchAccounts', async () => [{ ...account, account: '+7 (914) 555-01-42' }]);
  t.mock.method(Channel, 'find', (filter) => query([
    { type: 'telegram', provider: 'gateway', isActive: true, state: 'connected', account: { phone: '79145550142', displayName: 'Different name' } },
  ].filter(sift(filter))));
  await assert.rejects(configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] }), (error) => error.statusCode === 409 && /напрямую/.test(error.message) && /отключите/i.test(error.message));
  assert.equal(state.writes.length, 0);
});

test('activation refuses the same direct username without regard to case or leading @', async (t) => {
  const state = fixture(t);
  t.mock.method(Channel, 'find', (filter) => query([
    { type: 'telegram', isActive: true, state: 'connected', account: { username: 'SuPpOrT' } },
  ].filter(sift(filter))));
  await assert.rejects(configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] }), (error) => error.statusCode === 409);
  assert.equal(state.writes.length, 0);
});

test('duplicate guard ignores other networks, disabled accounts, Wazzup channels and display names', async (t) => {
  fixture(t);
  t.mock.method(Channel, 'find', (filter) => query([
    { type: 'whatsapp', provider: 'gateway', isActive: true, state: 'connected', account: { username: 'support' } },
    { type: 'telegram', provider: 'gateway', isActive: false, account: { username: 'support' } },
    { type: 'telegram', provider: 'wazzup', isActive: true, state: 'connected', account: { username: 'support' } },
    { type: 'telegram', provider: 'gateway', isActive: true, state: 'connected', name: 'Поддержка', account: { displayName: '@support', username: 'another_account' } },
  ].filter(sift(filter))));
  const prepared = await configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] });
  assert.equal(prepared.isActive, true);
});

test('duplicate guard only checks selected remote accounts and does not reinterpret usernames as phone numbers', async (t) => {
  fixture(t);
  t.mock.method(provider, 'fetchAccounts', async () => [{ ...account, account: 'support79145550142' }, { ...account, id: 'unselected', account: '@taken' }]);
  t.mock.method(Channel, 'find', (filter) => query([
    { type: 'telegram', isActive: true, state: 'connected', account: { phone: '79145550142', username: 'taken' } },
  ].filter(sift(filter))));
  assert.equal((await configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] })).isActive, true);
});

test('disabled Wazzup configuration does not query direct channels', async (t) => {
  fixture(t);
  t.mock.method(Channel, 'find', () => assert.fail('disabled configuration must not query channels'));
  assert.equal((await configuration.prepareConfiguration({ isActive: false })).isActive, false);
});


test('accounts released by logout or disconnect can be activated through Wazzup', async (t) => {
  fixture(t);
  for (const state of ['loggedOut', 'disconnected']) {
    t.mock.method(Channel, 'find', (filter) => query([
      { type: 'telegram', provider: 'gateway', isActive: true, state, account: { username: 'support' } },
    ].filter(sift(filter))));
    assert.equal((await configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] })).isActive, true);
  }
});

test('successful active save refreshes health and preserves the last real message timestamp', async (t) => {
  const lastMessageAt = new Date('2026-11-01T00:00:00Z');
  const state = fixture(t, { isActive: false, health: { lastError: 'previous error', lastErrorHint: 'previous hint', lastErrorAt: new Date('2026-11-02T00:00:00Z'), lastMessageAt } });
  const prepared = await configuration.prepareConfiguration({ isActive: true, apiKey: 'key', channelIds: ['remote-1'] });
  const before = Date.now();
  const result = await configuration.saveConfiguration(prepared);
  assert.ok(result.health.lastCheckedAt.getTime() >= before);
  assert.equal(result.health.lastOkAt.getTime(), result.health.lastCheckedAt.getTime());
  assert.equal(result.health.lastError, '');
  assert.equal(result.health.lastErrorHint, '');
  assert.equal(result.health.lastErrorAt, null);
  assert.deepEqual(result.health.lastMessageAt, lastMessageAt);
  assert.equal(state.writes.at(-1).$set.health, undefined);
});
