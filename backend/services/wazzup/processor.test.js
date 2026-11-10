const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProcessor, aggregateStatus } = require('./processor');
const channel = { _id: '64f600000000000000000001', type: 'max', providerChannelId: 'max-id' };
test('early outbound echo waits for leased send; correlated echo confirms one existing message without downloading files', async () => {
  let own = null, pending = true;
  const events = [];
  const process = createProcessor({ findChannel: async () => channel, findMessage: async () => own, hasSending: async () => pending, media: async () => assert.fail('own media should not download'), ingest: async event => { events.push(event); return { ok: true }; }, updateAccount: async () => {} });
  const item = { kind: 'messages', payload: { channelId: 'max-id', messageId: 'msg', chatId: 'peer', chatType: 'max', isEcho: true, type: 'image', contentUri: 'https://store.wazzup24.com/a', dateTime: '2026-11-10T01:00:00Z' } };
  assert.equal(await process(item), false);
  assert.equal(events.length, 0);
  own = { origin: 'hd', jobId: '64f600000000000000000002' }; pending = false;
  assert.equal(await process(item), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].message.jobId, own.jobId);
});
test('statuses without channelId resolve only an existing message in selected Wazzup channels', async () => {
  const events = [];
  const process = createProcessor({ findChannel: async () => assert.fail(), findMessage: async () => ({ channelId: channel._id, externalChatId: 'peer', jobId: '64f600000000000000000002' }), status: async (_own, raw) => raw.status, ingest: async event => { events.push(event); return { ok: true }; } });
  assert.equal(await process({ kind: 'statuses', payload: { messageId: 'msg', status: 'read' } }), true);
  assert.equal(events[0].type, 'message.status');
  assert.equal(events[0].status, 'read');
  assert.equal(events[0].jobId, '64f600000000000000000002');
});
test('multi-part delivery waits for every part and never moves backwards', () => {
  assert.equal(aggregateStatus(['a', 'b'], { a: 'read' }), 'sent');
  assert.equal(aggregateStatus(['a', 'b'], { a: 'read', b: 'delivered' }), 'delivered');
  assert.equal(aggregateStatus(['a', 'b'], { a: 'read', b: 'read' }), 'read');
  assert.equal(aggregateStatus(['a', 'b'], { a: 'read', b: 'failed' }), 'failed');
});

test('initial outgoing message status is applied even without a separate status webhook', async () => {
  const events = [];
  const own = { channelId: channel._id, externalChatId: 'peer', externalId: 'msg', origin: 'hd', jobId: '64f600000000000000000002' };
  const process = createProcessor({ findChannel: async () => channel, findMessage: async () => own, status: async (_own, raw) => raw.status, ingest: async event => { events.push(event); return { ok: true }; } });
  await process({ kind: 'messages', payload: { channelId: 'max-id', messageId: 'msg', chatId: 'peer', chatType: 'max', isEcho: true, type: 'text', text: 'abc', status: 'error', dateTime: '2026-11-10T01:00:00Z' } });
  assert.deepEqual(events.map(event => event.type), ['message', 'message.status']);
  assert.equal(events[1].status, 'failed');
});

test('only accepted incoming messages contribute incoming-message health', async () => {
  const accepted = [];
  const process = createProcessor({ findChannel: async () => channel, findMessage: async () => null, updateAccount: async () => {}, ingest: async () => ({ ok: true }), onMessage: async sentAt => accepted.push(sentAt) });
  await process({ kind: 'channelsUpdates', payload: { channelId: 'max-id', state: 'active' } });
  await process({ kind: 'messages', payload: { channelId: 'max-id', messageId: 'bad' } });
  assert.equal(accepted.length, 0);
  await process({ kind: 'messages', payload: { channelId: 'max-id', messageId: 'msg', chatId: 'peer', chatType: 'max', isEcho: false, type: 'text', text: 'abc', dateTime: '2026-11-10T01:00:00Z' } });
  assert.equal(accepted.length, 1);
  assert.equal(new Date(accepted[0]).toISOString(), '2026-11-10T01:00:00.000Z');
});
