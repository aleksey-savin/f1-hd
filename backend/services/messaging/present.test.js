// node --test services/messaging/present.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { publicName, mirrorAuthorName, commentChannel, conversationRow, messageRow, candidateRow } = require("./present");

test("the comment channel block carries names only", () => {
  const block = commentChannel(
    {
      network: "whatsapp",
      conversationId: "c1",
      messageId: "m1",
      direction: "in",
      authorName: "Андрей · WhatsApp",
      status: undefined,
      // лишнее отбрасывается, даже если его передали по ошибке
      phone: "+79142073318",
      username: "andrey",
      externalId: "79142073318@s.whatsapp.net",
    },
    new Date("2026-09-24T10:00:00Z"),
  );
  assert.deepEqual(Object.keys(block).sort(), ["authorName", "conversationId", "direction", "messageId", "network"]);
  assert.equal(JSON.stringify(block).includes("7914"), false);
});

test("a person without a real name is «Собеседник», never a phone or @nick", () => {
  assert.equal(publicName({ firstName: "Андрей" }), "Андрей");
  assert.equal(publicName({ displayName: "Марина Соколова", phone: "+79145550142" }), "Марина Соколова");
  assert.equal(publicName({ phone: "+79142073318", username: "kostya_it" }), "Собеседник");
  assert.equal(publicName(null), "Собеседник");
});

test("mirror author names", () => {
  const channel = { name: "Telegram — корпоративный", account: { displayName: "F1Lab Поддержка" } };
  // связанный пользователь — имя берёт интерфейс из автора комментария
  assert.equal(mirrorAuthorName({ identity: { userId: "u1", firstName: "Марина" }, message: { direction: "in", origin: "client" }, channel, network: "telegram" }), "");
  assert.equal(
    mirrorAuthorName({ identity: { displayName: "Андрей", phone: "+7914" }, message: { direction: "in", origin: "client" }, channel, network: "whatsapp" }),
    "Андрей · WhatsApp",
  );
  assert.equal(mirrorAuthorName({ identity: null, message: { direction: "out", origin: "device" }, channel, network: "telegram" }), "F1Lab Поддержка · с телефона");
  // ответ из HD — автор комментария сам сотрудник, подпись не нужна
  assert.equal(mirrorAuthorName({ identity: null, message: { direction: "out", origin: "hd" }, channel, network: "telegram" }), "");
});

const ids = { conv: "64f300000000000000000001", ident: "64f400000000000000000001", user: "64f100000000000000000001", company: "64f200000000000000000001", ticket: "64f500000000000000000001" };

test("a direct conversation row is named by the linked user", () => {
  const row = conversationRow(
    {
      _id: ids.conv,
      kind: "direct",
      network: "telegram",
      title: "",
      counterpartIdentityId: ids.ident,
      companyId: ids.company,
      binding: { ticketId: ids.ticket, ticketNum: 56812, endedAt: null },
      decision: { ticketId: null },
      lastMessage: { at: new Date("2026-09-24T10:42:00Z"), direction: "in", origin: "client", preview: "Оранжевый мигает", authorName: "Соколова Марина" },
      awaitingSince: new Date("2026-09-24T10:42:00Z"),
      hidden: false,
    },
    {
      identities: new Map([[ids.ident, { _id: ids.ident, userId: ids.user, username: "m_sokolova" }]]),
      users: new Map([[ids.user, { _id: ids.user, lastName: "Соколова", firstName: "Марина" }]]),
      companies: new Map([[ids.company, { _id: ids.company, alias: "ТД Восток" }]]),
      unread: new Map([[ids.conv, 250]]),
    },
  );
  assert.equal(row.title, "Соколова Марина");
  assert.equal(row.unknown, false);
  assert.deepEqual(row.company, { id: ids.company, alias: "ТД Восток" });
  assert.deepEqual(row.ticket, { id: ids.ticket, num: 56812 });
  assert.equal(row.unread, 99);
  assert.equal(row.decision, null);
});

test("an unknown direct contact is named by the identity and flagged", () => {
  const row = conversationRow(
    { _id: ids.conv, kind: "direct", network: "whatsapp", title: "", counterpartIdentityId: ids.ident, binding: {}, decision: {}, lastMessage: {} },
    { identities: new Map([[ids.ident, { _id: ids.ident, phone: "79142073318" }]]) },
  );
  assert.equal(row.title, "+7 (914) 207-33-18");
  assert.equal(row.unknown, true);
  assert.equal(row.ticket, null);
  assert.equal(row.lastMessage, null);
});

test("an ended binding is not a ticket of the row", () => {
  const row = conversationRow({ _id: ids.conv, kind: "direct", network: "telegram", binding: { ticketId: ids.ticket, ticketNum: 1, endedAt: new Date() }, decision: { ticketId: ids.ticket, ticketNum: 1 }, lastMessage: {} }, {});
  assert.equal(row.ticket, null);
  assert.deepEqual(row.decision, { ticketId: ids.ticket, ticketNum: 1 });
});

test("message rows: author, reply and system event", () => {
  const ctx = {
    identities: new Map([[ids.ident, { _id: ids.ident, displayName: "Андрей" }]]),
    users: new Map([[ids.user, { _id: ids.user, lastName: "Лебедев", firstName: "Игорь" }]]),
    replies: new Map([["r1", { _id: "r1", text: "Очередь очистил", authorName: "", authorUserId: ids.user }]]),
  };
  const inbound = messageRow({ _id: "m1", seq: 3, direction: "in", origin: "client", kind: "text", text: "Бумагу вынимали", identityId: ids.ident, replyToId: "r1", sentAt: new Date(), attachments: [], status: "received" }, ctx);
  assert.equal(inbound.author.name, "Андрей");
  assert.equal(inbound.author.isStaff, false);
  assert.deepEqual(inbound.replyTo, { id: "r1", authorName: "Лебедев Игорь", text: "Очередь очистил" });

  const outbound = messageRow({ _id: "m2", seq: 4, direction: "out", origin: "hd", kind: "text", text: "Будем в 14:00", authorUserId: ids.user, sentAt: new Date(), attachments: [], status: "read" }, ctx);
  assert.equal(outbound.author.name, "Лебедев Игорь");
  assert.equal(outbound.author.isStaff, true);

  const system = messageRow({ _id: "m3", seq: 5, direction: "system", origin: "system", kind: "event", text: "", sentAt: new Date(), attachments: [], event: { kind: "ticketCreated", ticketNum: 56812, byName: "Лебедев Игорь" } }, ctx);
  assert.deepEqual(system.event, { kind: "ticketCreated", ticketNum: 56812, byName: "Лебедев Игорь", targetName: "", count: null });
});

test("identity candidates carry name, position and company — never contacts", () => {
  const row = candidateRow({
    _id: "u1",
    firstName: "Андрей",
    lastName: "Кузнецов",
    position: "завхоз",
    company: { _id: "c1", alias: "Примавто" },
    email: "a.kuznetsov@primavto.ru",
    phone: "+79142073318",
  });
  assert.deepEqual(row, { id: "u1", name: "Кузнецов Андрей", position: "завхоз", company: "Примавто" });
  assert.equal(JSON.stringify(row).includes("7914"), false);
  assert.equal(JSON.stringify(row).includes("@"), false);
  assert.deepEqual(candidateRow({ _id: "u2", firstName: "Ольга" }), { id: "u2", name: "Ольга", position: "", company: "" });
});
