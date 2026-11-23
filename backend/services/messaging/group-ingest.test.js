require('module-alias/register');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const { normalizeMessage } = require('../wazzup/events');
const { validateEvent } = require('./events');
const { messageRow } = require('./present');

// In-memory persistence boundary; normalization, validation, ingest, identities,
// waiting rules and presentation run as production code. No live notifications.
const stub = (path, exports) => {
  const id = require.resolve(path);
  const entry = new Module(id);
  Object.assign(entry, { loaded: true, exports });
  require.cache[id] = entry;
};
let rows, notices, failNotification, failMirror;
const clone = value => structuredClone(value);
const query = read => ({
  select() { return this; },
  lean: async () => clone(read()),
  then(resolve, reject) { return this.lean().then(resolve, reject); },
});
const set = (row, path, value) => {
  const parts = path.split('.');
  for (const key of parts.slice(0, -1)) row = row[key] ||= {};
  row[parts.at(-1)] = clone(value);
};
const update = (row, change, inserted = false) => {
  for (const [key, value] of Object.entries({ ...(inserted ? change.$setOnInsert : {}), ...change.$set })) set(row, key, value);
  for (const key of Object.keys(change.$unset || {})) delete row[key];
  for (const [key, value] of Object.entries(change.$inc || {})) row[key] = (row[key] || 0) + value;
  for (const [key, value] of Object.entries(change.$push || {})) (row[key] ||= []).push(clone(value));
};
const model = name => ({
  find: filter => query(() => rows[name].filter(sift(filter))),
  findOne: filter => query(() => rows[name].find(sift(filter)) || null),
  findById: id => query(() => rows[name].find(row => row._id === id) || null),
  findOneAndUpdate: (filter, change, options = {}) => query(() => {
    let row = rows[name].find(sift(filter));
    const inserted = !row;
    if (!row) {
      if (!options.upsert) return null;
      row = { _id: `${name}-${rows[name].length}`, ...filter };
      rows[name].push(row);
    }
    update(row, change, inserted);
    return row;
  }),
  updateOne: async (filter, change) => {
    if (name === "comment" && failMirror) { failMirror = false; throw new Error("mirror unavailable"); }
    const row = rows[name].find(sift(filter));
    if (!row) return { matchedCount: 0, modifiedCount: 0 };
    const before = JSON.stringify(row);
    update(row, change);
    return { matchedCount: 1, modifiedCount: Number(before !== JSON.stringify(row)) };
  },
  create: async data => {
    const row = { _id: `${name}-${rows[name].length}`, ...clone(data) };
    rows[name].push(row);
    return { toObject: () => clone(row) };
  },
});
for (const name of ['channel', 'conversation', 'message', 'channelIdentity', 'user', 'preferences', 'comment']) stub(`@/models/${name}`, model(name));
stub('@/models/ticket', { Ticket: model('ticket') });
stub('@/services/callerIdentityService', { findUsersByPhone: async () => [] });
stub('@/services/pulse', { bus: { bump() {} } });
stub('./notify', { notifyWaiting: async notice => {
  if (failNotification) { failNotification = false; throw new Error('bell unavailable'); }
  notices.push(notice);
} });
const { ingestEvent } = require('./ingest');
const channel = { _id: '64f600000000000000000001', type: 'telegram', provider: 'wazzup', providerChannelId: 'remote', isActive: true, name: 'Корпоративный аккаунт' };
const raw = (id, overrides = {}) => ({ channelId: 'remote', messageId: id, chatType: 'telegroup', chatId: 'group', dateTime: '2026-11-12T01:00:00Z', isEcho: false, type: 'text', text: id, contact: { name: 'Группа' }, ...overrides });
const ingest = async payload => {
  const checked = validateEvent(normalizeMessage(payload, rows.channel[0]));
  assert.equal(checked.ok, true);
  assert.deepEqual(await ingestEvent(checked.event), { ok: true });
};
beforeEach(() => {
  rows = { channel: [clone(channel)], conversation: [], message: [], channelIdentity: [], user: [], preferences: [{ modules: { messaging: { isActive: true } } }], ticket: [], comment: [] };
  notices = [];
  failNotification = false;
  failMirror = false;
});

test('group messages from unknown authors stay distinct, anonymous and replay-safe', async () => {
  for (const [network, chatType] of [['telegram', 'telegroup'], ['whatsapp', 'whatsgroup']]) {
    rows.channel[0].type = network;
    const first = raw(`${network}-1`, { chatType, chatId: network });
    const second = raw(`${network}-2`, { chatType, chatId: network, dateTime: '2026-11-12T01:01:00Z' });
    await ingest(first);
    await ingest(second);
    await ingest(first);
    await ingest(second);
  }
  assert.equal(rows.conversation.length, 2);
  assert.equal(rows.message.length, 4);
  assert.deepEqual(rows.channelIdentity, []);
  assert.equal(notices.length, 2);
  for (const conversation of rows.conversation) {
    assert.deepEqual(conversation.participants || [], []);
    assert.equal(conversation.lastMessage.authorName, 'Неизвестный участник');
    assert.equal(+conversation.awaitingSince, +new Date('2026-11-12T01:00:00Z'));
  }
  for (const message of rows.message) {
    assert.equal(message.identityId, null);
    assert.equal(message.origin, 'client');
    assert.deepEqual(messageRow(message).author, { name: 'Неизвестный участник', userId: null, isStaff: false });
  }
});

test('an unknown author cannot inherit a previously linked synthetic group identity', async () => {
  rows.channelIdentity.push({ _id: 'old', network: 'telegram', externalId: 'wazzup:remote:group:unknown', userId: 'staff', isStaff: true });
  await ingest(raw('new'));
  assert.equal(rows.message[0].identityId, null);
  assert.equal(rows.message[0].origin, 'client');
  assert.ok(rows.conversation[0].awaitingSince);
});

test('a corporate device reply still clears waiting after an anonymous group message', async () => {
  await ingest(raw('incoming'));
  await ingest(raw('answer', { isEcho: true, dateTime: '2026-11-12T01:01:00Z' }));
  assert.equal(rows.conversation[0].awaitingSince, null);
  assert.equal(rows.message[1].origin, 'device');
  assert.equal(rows.message.length, 2);
  assert.equal(notices.length, 1);
});

test('a verified gateway group participant is still recognised as staff and clears waiting', async () => {
  await ingest(raw('incoming'));
  rows.channelIdentity.push({ _id: 'known', network: 'telegram', externalId: '777', userId: 'staff', isStaff: true });
  rows.user.push({ _id: 'staff', firstName: 'Игорь' });
  const event = validateEvent({ type: 'message', channelId: channel._id, chat: { id: 'group', kind: 'group' }, message: { id: 'answer', direction: 'in', sender: { id: '777', name: 'Игорь' }, text: 'Ответ', sentAt: '2026-11-12T01:01:00Z' } });
  assert.equal(event.ok, true);
  await ingestEvent(event.event);
  assert.equal(rows.message[1].identityId, 'known');
  assert.equal(rows.message[1].origin, 'staff');
  assert.equal(rows.conversation[0].awaitingSince, null);
  assert.deepEqual(rows.conversation[0].participants, [{ identityId: 'known', isStaff: true }]);
});

test('echo and status events cannot use a job on another channel', async () => {
  const jobId = '64f600000000000000000009';
  const own = { _id: 'msg', channelId: 'other-channel', jobId, origin: 'hd', direction: 'out', status: 'queued' };
  rows.message.push(own);
  const echo = { type: 'message', channelId: channel._id, chat: { id: 'group', kind: 'group' },
    message: { id: 'echo', origin: 'hd', direction: 'out', jobId } };
  assert.equal((await ingestEvent(echo)).ignored, true);
  await ingestEvent({ type: 'message.status', channelId: channel._id, jobId, status: 'read' });
  assert.equal(own.status, 'queued');
  assert.equal(own.externalId, undefined);
  assert.equal(rows.message.length, 1);
  own.channelId = channel._id;
  await ingestEvent(echo);
  assert.equal(own.status, 'sent');
  assert.equal(own.externalId, 'echo');
});

test('a failed bell write leaves the wait and message available for replay', async () => {
  failNotification = true;
  await assert.rejects(ingest(raw('first')), /bell unavailable/);
  assert.equal(rows.conversation[0].waitNotifiedAt, undefined);
  await ingest(raw('same-time'));
  assert.equal(notices.length, 0);
  await ingest(raw('first'));
  assert.equal(notices.length, 1);
  assert.equal(+rows.conversation[0].waitNotifiedAt, +rows.message[0].sentAt);
});

test('replayed edits and deletions finish a failed ticket mirror without duplicating revisions or changing deletion time', async () => {
  await ingest(raw('original'));
  const message = rows.message[0];
  message.commentId = 'comment';
  rows.comment.push({ _id: 'comment', content: 'original' });
  const edit = { type: 'message.edited', channelId: channel._id, chat: { id: 'group' },
    message: { id: message.externalId, editedAt: new Date(1000), text: 'changed' } };
  failMirror = true;
  await assert.rejects(ingestEvent(edit), /mirror unavailable/);
  assert.equal(message.text, 'changed');
  await ingestEvent(edit);
  assert.equal(rows.comment[0].content, 'changed');
  assert.equal(message.revisions.length, 1);
  const newer = { ...edit, message: { ...edit.message, editedAt: new Date(2000), text: 'newest' } };
  await ingestEvent(newer);
  await ingestEvent(edit);
  assert.equal(rows.comment[0].content, 'newest');
  assert.equal(message.revisions.length, 2);

  const deletion = { type: 'message.deleted', channelId: channel._id, chat: { id: 'group' }, messageIds: [message.externalId], at: new Date(3000) };
  failMirror = true;
  await assert.rejects(ingestEvent(deletion), /mirror unavailable/);
  await ingestEvent({ ...deletion, at: new Date(4000) });
  assert.equal(+rows.comment[0].channel.deletedAt, 3000);
  assert.equal(+message.deletedAt, 3000);
  assert.equal(rows.comment[0].content, 'newest');
});

test('chat sync records all 500 validated group participants', async () => {
  await ingest(raw('initial'));
  const participants = Array.from({ length: 500 }, (_, i) => ({ id: String(i + 1) }));
  const checked = validateEvent({ type: 'chat', channelId: channel._id, chat: { id: 'group', kind: 'group', participants } });
  assert.equal(checked.ok, true);
  await ingestEvent(checked.event);
  assert.equal(new Set(rows.conversation[0].participants.map(member => member.identityId)).size, 500);
});

const deliveryFixture = () => {
  const message = { _id: 'out', channelId: channel._id, externalChatId: 'group', jobId: 'old-attempt',
    origin: 'hd', direction: 'out', status: 'queued', commentId: 'mirror' };
  const comment = { _id: 'mirror', channel: { messageId: message._id, status: 'queued' } };
  rows.message.push(message);
  rows.comment.push(comment);
  const echo = { type: 'message', channelId: channel._id, chat: { id: 'group' },
    message: { direction: 'out', origin: 'hd', id: 'provider-id', jobId: message.jobId } };
  const status = { type: 'message.status', channelId: channel._id, status: 'failed', jobId: message.jobId, error: 'private provider detail' };
  return { message, comment, echo, status };
};

for (const type of ['echo', 'status']) {
  test(`a superseded job’s ${type} event cannot update the retried message or its comment`, async (t) => {
    const fixture = deliveryFixture();
    const Message = require('@/models/message');
    const updateOne = Message.updateOne;
    t.mock.method(Message, 'updateOne', async (filter, update) => {
      fixture.message.jobId = 'new-attempt';
      return updateOne(filter, update);
    });
    await assert.rejects(ingestEvent(fixture[type]), /changed during delivery update/);
    await ingestEvent(fixture[type]);
    assert.equal(fixture.message.status, 'queued');
    assert.equal(fixture.message.externalId, undefined);
    assert.equal(fixture.comment.channel.status, 'queued');
  });

  test(`replaying the ${type} repairs a failed comment write after the delivery status was stored`, async () => {
    const fixture = deliveryFixture();
    failMirror = true;
    await assert.rejects(ingestEvent(fixture[type]), /mirror unavailable/);
    const expected = type === 'echo' ? 'sent' : 'failed';
    assert.equal(fixture.message.status, expected);
    assert.equal(fixture.comment.channel.status, 'queued');
    await ingestEvent(fixture[type]);
    assert.equal(fixture.comment.channel.status, expected);
    if (expected === 'failed') assert.equal(fixture.comment.channel.error, 'Не доставлено');
    const checkpoint = +fixture.comment.channel.statusAt;
    await ingestEvent(fixture[type]);
    assert.equal(+fixture.comment.channel.statusAt, checkpoint);
  });
}
