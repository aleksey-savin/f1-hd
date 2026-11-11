require('module-alias/register');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sift = require('sift').default;
const stub = (path, exports) => {
  const id = require.resolve(path), entry = new Module(id);
  Object.assign(entry, { loaded: true, exports });
  require.cache[id] = entry;
};
const id = n => n.toString(16).padStart(24, '0');
const query = value => ({
  select() { return this; },
  sort() { return this; },
  limit(n) { value = value.slice(0, n); return this; },
  lean: async () => value,
});
const company = id(100), userId = id(101);
const tickets = Array.from({ length: 12 }, (_, index) => ({
  _id: id(index + 1), num: index + 1, title: `Ticket ${index + 1}`,
  isClosed: false, company: { _id: company }, responsibles: [],
}));
// Newest six tickets are already linked. The last ticket is outside the scope.
tickets[11].company = { _id: id(102) };
const conversation = {
  _id: id(103), kind: 'direct', network: 'telegram', companyId: company,
  ticketBindings: tickets.slice(0, 6).map(ticket => ({ ticketId: ticket._id, ticketNum: ticket.num })),
};
stub('@/models/ticket', { Ticket: { find: filter => query(tickets.filter(sift(filter))) } });
stub('@/models/conversation', { findById: () => query(conversation) });
stub('@/models/message', { countDocuments: async () => 0 });
stub('@/models/channelIdentity', { find: () => query([]) });
stub('@/models/conversationRead', { find: () => query([]), findOne: () => query(null) });
stub('@/models/channel', { findById: () => query(null) });
stub('@/models/user', { find: () => query([]) });
stub('@/models/company', { find: () => query([]) });
const { get } = require('./conversation');

test('card offers five unlinked company tickets even when the newest six are already linked', async () => {
  let body;
  await get({
    params: { id: conversation._id },
    auth: { userId, isAdmin: true, can: () => true },
  }, {
    status() { return this; }, json(value) { body = value; },
  }, error => { throw error; });
  assert.deepEqual(body.openTickets.map(ticket => ticket.num), [7, 8, 9, 10, 11]);
  assert.equal(body.tickets.length, 6);
});
