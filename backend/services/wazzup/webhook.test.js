const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWebhook } = require('./webhook');
const invoke = async (handler, token, body) => {
  let status, result;
  await handler({ query: { token }, body }, { status(value) { status = value; return this; }, json(value) { result = value; return this; } });
  return { status, result };
};
test('webhook requires its own token even for probe requests', async () => {
  let enqueued = 0;
  const handler = createWebhook({ load: async () => ({ token: 'a'.repeat(43), isActive: true }), enqueue: async () => enqueued++ });
  for (const token of [undefined, {}, 'wrong']) assert.equal((await invoke(handler, token, { test: true })).status, 401);
  assert.equal((await invoke(handler, 'a'.repeat(43), { test: true })).status, 200);
  assert.equal(enqueued, 0);
});
test('a subscription probe succeeds before activation but disabled normal messages are ignored', async () => {
  const handler = createWebhook({ load: async () => ({ token: 'secret', isActive: false }), enqueue: async () => assert.fail('disabled event must not enter inbox') });
  assert.equal((await invoke(handler, 'secret', { test: true })).status, 200);
  assert.equal((await invoke(handler, 'secret', { messages: [{}] })).result.ignored, true);
});
test('a 200 webhook response follows durable enqueue; database failure requests provider retry', async () => {
  const entries = [];
  const handler = createWebhook({ load: async () => ({ token: 'secret', isActive: true }), enqueue: async (kind, raw) => entries.push([kind, raw]) });
  const body = { messages: [{ messageId: 'one' }], statuses: [{ messageId: 'two' }], channelsUpdates: [{ channelId: 'three' }] };
  assert.equal((await invoke(handler, 'secret', body)).status, 200);
  assert.deepEqual(entries.map(entry => entry[0]), ['messages', 'statuses', 'channelsUpdates']);
  const fail = createWebhook({ load: async () => ({ token: 'secret', isActive: true }), enqueue: async () => { throw new Error('db'); } });
  assert.equal((await invoke(fail, 'secret', body)).status, 503);
});
test('malformed and excessive webhook arrays are refused without persistence', async () => {
  const handler = createWebhook({ load: async () => ({ token: 'secret', isActive: true }), enqueue: async () => assert.fail() });
  for (const body of [null, [], { messages: {} }, { messages: [null] }, { statuses: Array(501).fill({}) }]) assert.equal((await invoke(handler, 'secret', body)).status, 400);
});
