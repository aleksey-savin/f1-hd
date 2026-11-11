// node --test services/messaging/visibility.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { visibilityFilter, queueFilter, listFilter, canSeeConversation } = require("./visibility");

const ME = "64f100000000000000000001";
const C1 = "64f200000000000000000001";
const C2 = "64f200000000000000000002";
const plain = (value) => JSON.parse(JSON.stringify(value));

// Заглушка req.auth с тем, что читает services/ticketScope.js
const auth = (tier, companies = [C1]) => ({
  userId: ME,
  isAdmin: tier === "all",
  isEndUser: false,
  can: (request) => tier === "companies" && Boolean(request.ticket?.includes("readCompanies")),
  legacy: { responsibleForCompanies: companies.map((id) => ({ id })) },
});

test("all-tier staff see every conversation", () => {
  assert.deepEqual(visibilityFilter(auth("all")), {});
  assert.equal(canSeeConversation({ companyId: C2 }, auth("all")), true);
});

test("ticket visibility and assignment never open unrelated correspondence", () => {
  const a = {...auth("companies"), can: req => req.conversation?.includes("read") || req.ticket?.includes("readAll")};
  assert.equal(canSeeConversation({companyId:null,assigneeId:ME},a),false);
  a.messagingScope = {ticketIds:[C1],conversationIds:[C2]};
  assert.equal(canSeeConversation({_id:C2},a),true);
  assert.equal(canSeeConversation({ticketBindings:[{ticketId:C1}]},a),true);
  assert.equal(canSeeConversation({ticketBindings:[{ticketId:C2}]},a),false);
});

test("queues", () => {
  const a = auth("companies");
  assert.deepEqual(plain(queueFilter("awaiting", a)), { hidden: { $ne: true }, awaitingSince: { $ne: null } });
  assert.deepEqual(plain(queueFilter("mine", a)), { hidden: { $ne: true } });
  assert.deepEqual(plain(queueFilter("unbound", a)), {
    hidden: { $ne: true },
    $or: [
      { ticketBindings: { $exists: false }, $or: [{ "binding.ticketId": null }, { "binding.endedAt": { $ne: null } }] },
      { ticketBindings: { $exists: true, $not: { $elemMatch: { ticketId: { $ne: null }, endedAt: null } } } },
    ],
  });
  assert.deepEqual(queueFilter("all", a), { hidden: { $ne: true } });
  assert.deepEqual(queueFilter("hidden", a), { hidden: true });
  assert.equal(queueFilter("everything", a), null);
});

test("list filter joins visibility, queue and extra with $and", () => {
  const filter = plain(listFilter("awaiting", auth("own"), { network: "telegram" }));
  assert.equal(filter.$and.length, 3);
  assert.deepEqual(filter.$and[2], { network: "telegram" });
  // у администратора видимость пустая — в $and её нет
  assert.equal(plain(listFilter("all", auth("all"))).$and.length, 1);
  assert.equal(listFilter("nope", auth("all")), null);
});

test('unbound queue follows canonical active links before the legacy pointer', () => {
  const matches = require('sift').default(queueFilter('unbound', auth('all')));
  assert.equal(matches({binding:{ticketId:'old',endedAt:new Date()},ticketBindings:[{ticketId:'active',endedAt:null}]}),false);
  assert.equal(matches({binding:{ticketId:'old'},ticketBindings:[]}),true);
});
