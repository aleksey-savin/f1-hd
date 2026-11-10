require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
for (const [path, exports] of [['../../models/ticket', { Ticket: {} }], ['../../utils/logger', { log() {}, info() {}, warn() {}, error() {} }]]) {
  const filename = require.resolve(path), entry = new Module(filename);
  Object.assign(entry, { filename, loaded: true, exports }); require.cache[filename] = entry;
}
const Message = require('../../models/message');
const Conversation = require('../../models/conversation');
const Channel = require('../../models/channel');
const ChannelJob = require('../../models/channelJob');
const { retryMessage } = require('./outbound');
test('manual Wazzup retry forgets old delivery ids so late old receipts cannot mark new attempt read', async t => {
  const message = { _id: '64f600000000000000000001', conversationId: '64f600000000000000000002', direction: 'out', origin: 'hd', status: 'failed', externalId: 'old-id', externalIds: ['old-id'], jobId: '64f600000000000000000003', text: 'abc', save: async () => {}, toObject() { return this; } };
  t.mock.method(Message, 'findById', async () => message);
  t.mock.method(Conversation, 'findById', () => ({ lean: async () => ({ _id: message.conversationId, channelId: '64f600000000000000000004' }) }));
  t.mock.method(Channel, 'findById', () => ({ lean: async () => ({ _id: '64f600000000000000000004', type: 'max', isActive: true, provider: 'wazzup' }) }));
  t.mock.method(ChannelJob, 'findById', () => ({ lean: async () => ({ payload: { chatId: 'peer', text: 'abc', attachments: [] } }) }));
  t.mock.method(ChannelJob, 'create', async fields => ({ ...fields, _id: '64f600000000000000000005' }));
  const retried = await retryMessage({ messageId: message._id, auth: { isEndUser: false, can: () => true } });
  assert.equal(retried.status, 'queued');
  assert.equal(retried.jobId, '64f600000000000000000005');
  assert.equal(retried.externalId, undefined);
  assert.equal(retried.externalIds, undefined);
});
