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
let rows, notices;
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
  for (const [key, value] of Object.entries(change.$inc || {})) row[key] = (row[key] || 0) + value;
  for (const [key, value] of Object.entries(change.$push || {})) (row[key] ||= []).push(clone(value));
};
const model = name => ({
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
stub('./notify', { notifyWaiting: async notice => notices.push(notice) });
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
