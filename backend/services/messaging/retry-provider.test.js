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
  t.mock.method(ChannelJob, 'findById', id => ({ lean: async () => String(id) === '64f600000000000000000003' ? { payload: { chatId: 'peer', text: 'abc', attachments: [] } } : null }));
  t.mock.method(ChannelJob, 'create', async fields => fields);
  t.mock.method(Message, 'updateOne', async (filter, update) => { Object.assign(message, update.$set || {}); for (const key of Object.keys(update.$unset || {})) delete message[key]; return { modifiedCount: 1 }; });
  t.mock.method(require('../../models/preferences'), 'findOne', () => ({ select() { return this; }, lean: async () => ({ modules: { messaging: { isActive: true } } }) }));
  const retried = await retryMessage({ messageId: message._id, auth: { isEndUser: false, can: () => true } });
  assert.equal(retried.status, 'queued');
  assert.notEqual(String(retried.jobId), '64f600000000000000000003');
  assert.equal(retried.externalId, undefined);
  assert.equal(retried.externalIds, undefined);
});
