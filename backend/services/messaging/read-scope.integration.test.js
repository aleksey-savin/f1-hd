require('module-alias/register');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const Module = require('node:module');
const enabled = process.env.HD_DIALOG_SCOPE_INTEGRATION === '1';
let db, client;
const stub = (path, exports) => {
  const id = require.resolve(path), entry = new Module(id);
  Object.assign(entry, { loaded: true, exports }); require.cache[id] = entry;
};
// Real Mongo query execution, isolated from application connections and counter
// initialization. These adapters implement only the read model methods under test.
const model = name => {
  const cursor = (filter, single = false) => {
    let order, count;
    const run = async () => {
      let query = db.collection(name).find(filter);
      if (order) query = query.sort(order);
      if (count) query = query.limit(count);
      const rows = await query.toArray(); return single ? rows[0] || null : rows;
    };
    return { select() { return this; }, sort(value) { order = value; return this; }, limit(value) { count = value; return this; }, lean: run, then(resolve, reject) { return run().then(resolve, reject); } };
  };
  return {
    find: filter => cursor(filter), findOne: filter => cursor(filter, true),
    findById: id => cursor({ _id: new ObjectId(String(id)) }, true),
    aggregate: pipeline => db.collection(name).aggregate(pipeline).toArray(),
    distinct: (field, filter) => db.collection(name).distinct(field, filter),
    countDocuments: filter => db.collection(name).countDocuments(filter),
  };
};
for (const [name, collection] of Object.entries({ conversation: 'conversations', message: 'messages', channelIdentity: 'channelidentities', conversationRead: 'conversationreads', channel: 'channels', user: 'users', company: 'companies' })) stub(`@/models/${name}`, model(collection));
stub('@/models/ticket', { Ticket: model('tickets') });
stub('@/services/pulse', { bus: { bump() {} } });
stub('@/services/storage', {});
const access = require('./access');
const { listFilter, canSeeConversation } = require('./visibility');
const { conversationSearchPipeline } = require('./search');
const controller = require('@/controllers/conversation');
const ids = Object.fromEntries(['me','other','current','former','foreign','mixed','closedChat','foreignChat','freeChat','channel','ownMessage','formerMessage','foreignMessage','freeMessage'].map((key, index) => [key, new ObjectId((index + 1).toString(16).padStart(24, '0'))]));
const auth = (...rights) => ({ userId: String(ids.me), isAdmin: false, isEndUser: false, legacy: {}, can: request => Object.entries(request).every(([resource, actions]) => actions.every(action => rights.includes(`${resource}.${action}`))) });
const own = () => auth('conversation.read', 'ticket.readAll');
const full = () => auth('conversation.readAll');
const call = async (method, user, query = {}, conversation = ids.mixed) => {
  let body;
  await controller[method]({ auth: user, query, params: { id: String(conversation) } }, { status() { return this; }, json(value) { body = value; } }, error => { throw error; });
  return body;
};
before(async () => {
  if (!enabled) return;
  const env = require('node:util').parseEnv(require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../../.env'), 'utf8'));
  client = new MongoClient('mongodb://127.0.0.1:27017/?authSource=admin', { auth: { username: env.MONGODB_USERNAME, password: env.MONGODB_PASSWORD }, serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db(`hd_dialog_read_scope_${randomUUID().replaceAll('-', '')}`);
  await db.collection('tickets').insertMany([
    { _id: ids.current, num: 1, title: 'Own ticket', responsibles: [{ _id: ids.me }], isClosed: false },
    { _id: ids.former, num: 2, title: 'Former ticket', responsibles: [{ _id: ids.other }], messagingReaderIds: [ids.me], isClosed: true },
    { _id: ids.foreign, num: 3, title: 'Foreign ticket', responsibles: [{ _id: ids.other }], isClosed: false },
  ]);
  const base = { kind: 'direct', network: 'telegram', channelId: ids.channel, hidden: false, title: 'Shared chat', ticketBindings: [], lastMessage: { at: new Date('2026-11-12T03:00:00Z'), preview: 'FOREIGN_SECRET', authorName: 'FOREIGN_AUTHOR', direction: 'in' } };
  await db.collection('conversations').insertMany([
    { ...base, _id: ids.mixed, ticketBindings: [{ ticketId: ids.current, ticketNum: 1 }, { ticketId: ids.foreign, ticketNum: 3 }], awaitingSince: new Date('2026-11-12T03:00:00Z') },
    { ...base, _id: ids.closedChat }, { ...base, _id: ids.foreignChat }, { ...base, _id: ids.freeChat },
  ]);
  const message = (id, chat, ticket, text, hour, seq) => ({ _id: id, conversationId: chat, ticketId: ticket, text, kind: 'text', direction: 'in', origin: 'client', authorName: text, sentAt: new Date(`2026-11-12T0${hour}:00:00Z`), updatedAt: new Date(`2026-11-12T0${hour}:00:00Z`), seq, attachments: [] });
  await db.collection('messages').insertMany([
    { ...message(ids.ownMessage, ids.mixed, ids.current, 'OWN_VISIBLE', 1, 1), replyToId: ids.foreignMessage },
    message(ids.foreignMessage, ids.mixed, ids.foreign, 'FOREIGN_SECRET', 3, 2),
    message(ids.formerMessage, ids.closedChat, ids.former, 'FORMER_VISIBLE', 2, 1),
    message(ids.freeMessage, ids.mixed, null, 'FREE_SECRET', 4, 3),
    message(new ObjectId(), ids.foreignChat, ids.foreign, 'PRIVATE_CHAT', 3, 1),
    message(new ObjectId(), ids.freeChat, null, 'UNRESOLVED_CHAT', 3, 1),
  ]);
});
after(async () => { if (db) await db.dropDatabase(); if (client) await client.close(); });
test('real DB scope includes current and former responsibility but ignores ticket.readAll', { skip: !enabled }, async () => {
  const viewer = await access.scopeAuth(own());
  assert.deepEqual(viewer.messagingScope.ticketIds.map(String).sort(), [ids.current, ids.former].map(String).sort());
  for (const id of [ids.mixed, ids.closedChat]) assert.equal(canSeeConversation(await db.collection('conversations').findOne({ _id: id }), viewer), true);
  assert.equal(canSeeConversation(await db.collection('conversations').findOne({ _id: ids.foreignChat }), viewer), false);
  const all = await access.scopeAuth(full()); assert.equal(all.messagingScope.all, true);
});
test('controller list rebuilds preview, bindings, unread and time from visible messages', { skip: !enabled }, async () => {
  const result = await call('list', own());
  assert.deepEqual(result.items.map(item => item.id).sort(), [ids.mixed, ids.closedChat].map(String).sort());
  const mixed = result.items.find(item => item.id === String(ids.mixed));
  assert.equal(mixed.lastMessage.preview, 'OWN_VISIBLE'); assert.equal(mixed.unread, 1);
  assert.equal(+mixed.lastMessage.at, +new Date('2026-11-12T01:00:00Z'));
  assert.deepEqual(mixed.tickets.map(ticket => ticket.id), [String(ids.current)]);
  assert.doesNotMatch(JSON.stringify(result), /FOREIGN_SECRET|FOREIGN_AUTHOR|FREE_SECRET/);
});
test('real aggregation search excludes foreign and free history in a mixed visible chat', { skip: !enabled }, async () => {
  const viewer = await access.scopeAuth(own());
  for (const term of ['FOREIGN_SECRET', 'FREE_SECRET', 'PRIVATE_CHAT', 'UNRESOLVED_CHAT']) {
    const rows = await db.collection('conversations').aggregate(conversationSearchPipeline({ filter: listFilter('all', viewer), query: term, auth: viewer, limit: 20 })).toArray();
    assert.equal(rows.length, 0, term);
    assert.equal((await call('list', own(), { q: term })).items.length, 0, term);
  }
  assert.equal((await call('list', own(), { q: 'FORMER_VISIBLE' })).items[0].id, String(ids.closedChat));
});
test('message history and changedSince hide foreign messages and foreign quoted content', { skip: !enabled }, async () => {
  for (const query of [{}, { changedSince: '2026-11-12T00:00:00Z' }]) {
    const result = await call('messages', own(), query);
    assert.deepEqual(result.items.map(item => item.id), [String(ids.ownMessage)]);
    assert.doesNotMatch(JSON.stringify(result), /FOREIGN_SECRET|FREE_SECRET/);
  }
  assert.equal((await call('messages', own(), {}, ids.closedChat)).items[0].text, 'FORMER_VISIBLE');
  await assert.rejects(call('messages', own(), {}, ids.foreignChat), error => error.statusCode === 404);
});
test('readAll without any ticket permission reads and searches every conversation message', { skip: !enabled }, async () => {
  assert.equal((await call('list', full())).items.length, 4);
  assert.equal((await call('messages', full())).items.length, 3);
  assert.equal((await call('list', full(), { q: 'FREE_SECRET' })).items[0].id, String(ids.mixed));
});
