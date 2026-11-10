require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const loggerPath = require.resolve('../../utils/logger');
const logger = new Module(loggerPath);
Object.assign(logger, { filename: loggerPath, loaded: true, exports: { log() {}, info() {}, warn() {}, error() {} } });
require.cache[loggerPath] = logger;
const worker = require('./worker');
const Channel = require('../../models/channel');
const ChannelJob = require('../../models/channelJob');
const WazzupSettings = require('../../models/wazzupSettings');
const WazzupEvent = require('../../models/wazzupEvent');
const query = value => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => value });

test('temporary media errors retry the durable inbox rather than losing an attachment', async t => {
  const raw = { contentUri: 'https://store.wazzup24.com/a.pdf' };
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(worker.receiveMedia(raw, { settings: {} }), /повторим автоматически/);
  globalThis.fetch = async () => { throw new Error('timeout'); };
  await assert.rejects(worker.receiveMedia(raw, { settings: {} }), /повторим автоматически/);
  globalThis.fetch = async () => new Response('gone', { status: 410 });
  assert.equal((await worker.receiveMedia(raw, { settings: {} })).status, 'failed');
});

test('media boundary does not fetch private/unknown hosts and refuses over-limit content', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('large', { headers: { 'content-length': '999999999' } }); });
  assert.equal((await worker.receiveMedia({ contentUri: 'https://127.0.0.1/private' }, {})).status, 'failed');
  assert.equal(calls, 0);
  assert.equal((await worker.receiveMedia({ contentUri: 'https://store.wazzup24.com/a' }, {})).status, 'skipped');
  assert.equal(calls, 1);
});

test('worker repairs channel sync after interrupted settings save and filters inbox by selection', async t => {
  const writes = [], reads = [];
  const settings = { isActive: true, channelIds: ['selected'], accounts: [{ id: 'selected', type: 'max', transport: 'max', name: 'Support', account: '79000000001', state: 'active' }] };
  t.mock.method(WazzupSettings, 'findById', () => query(settings));
  t.mock.method(Channel, 'updateMany', async (filter, update) => writes.push({ filter, update }));
  t.mock.method(Channel, 'findOneAndUpdate', async (filter, update) => writes.push({ filter, update }));
  t.mock.method(Channel, 'find', filter => { reads.push(filter); return query([]); });
  t.mock.method(ChannelJob, 'find', () => query([]));
  t.mock.method(WazzupEvent, 'findOneAndUpdate', () => query(null));
  await worker.runWazzupTick();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].filter.providerChannelId, { $nin: ['selected'] });
  assert.equal(writes[1].filter.providerChannelId, 'selected');
  assert.deepEqual(reads[0].providerChannelId, { $in: ['selected'] });
  await worker.runWazzupTick();
  assert.equal(writes.length, 2, 'health-only ticks must not rewrite channel state/pulse');
  settings.isActive = false;
  await worker.runWazzupTick();
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[2].filter.providerChannelId, { $nin: [] });
});
