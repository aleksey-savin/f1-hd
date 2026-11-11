require("module-alias/register");
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sift = require("sift").default;

const stub = (name, exports) => {
  const id = require.resolve(name);
  const entry = new Module(id);
  entry.loaded = true;
  entry.exports = exports;
  require.cache[id] = entry;
};
let conversations, identities, channels, tickets, messages, comments;
const valueAt = (row, path) => path.split(".").reduce((value, key) => value?.[key], row);
const query = (rows, one = false) => {
  let list = [...rows];
  return {
    sort(order) {
      list.sort((a, b) => {
        for (const [path, direction] of Object.entries(order)) {
          const left = valueAt(a, path), right = valueAt(b, path);
          if (left < right) return -direction;
          if (left > right) return direction;
        }
        return 0;
      });
      return this;
    },
    limit(count) { list = list.slice(0, count); return this; },
    select() { return this; },
    lean: async () => one ? list[0] : list,
  };
};
stub("@/models/ticket", { Ticket: {
  find: (filter) => query(tickets.filter(sift(filter))),
  findById: (id) => query(tickets.filter((ticket) => ticket._id === id), true),
} });
stub("@/models/conversation", {
  find: (filter) => query(conversations.filter(sift(filter))),
  findOne: (filter) => query(conversations.filter(sift(filter)), true),
});
stub("@/models/channelIdentity", { find: (filter) => query(identities.filter(sift(filter))) });
stub("@/models/channel", { find: (filter) => query(channels.filter(sift(filter))) });
stub("@/models/message", { findOne: (filter) => query(messages.filter(sift(filter)), true) });
stub("@/models/comment", { findOne: (filter) => query(comments.filter(sift(filter)), true) });
const { deliveryRoutes } = require("./origin");

const ticket = { _id: "ticket", applicantId: "client", source: "Вручную" };
beforeEach(() => {
  identities = [{ _id: "identity", userId: "client" }];
  channels = [{ _id: "channel", type: "telegram", isActive: true }];
  conversations = [{ _id: "original", channelId: "channel", network: "telegram", kind: "direct", counterpartIdentityId: "identity" }];
  tickets = [ticket];
  messages = [];
  comments = [];
});

test("обычная заявка предлагает чаты заявителя, стандартный канал выбран по умолчанию", async () => {
  const result = await deliveryRoutes(ticket);
  assert.equal(result.routes[0].conversationId, "original");
  assert.equal(result.defaultRoute, "notify");
});

test("старая заявка с вложенным applicant тоже предлагает чаты заявителя", async () => {
  const result = await deliveryRoutes({ ...ticket, applicantId: undefined, applicant: { _id: "client" } });
  assert.equal(result.routes.length, 1);
  assert.equal(result.defaultRoute, "notify");
});

test("ручная заявка после ответа в мессенджер сохраняет стандартный канал по умолчанию", async () => {
  conversations[0].binding = { ticketId: "ticket" };
  comments = [{ ticketId: "ticket", channel: { direction: "in", conversationId: "original" } }];
  assert.equal((await deliveryRoutes(ticket)).defaultRoute, "notify");
});

test("заявка из диалога сохраняет исходный канал при привязке другого чата", async () => {
  tickets = [{ ...ticket, source: "Telegram", originConversationId: "original" }];
  conversations.push({ ...conversations[0], _id: "another", binding: { ticketId: "ticket" } });
  assert.equal((await deliveryRoutes(tickets[0])).defaultRoute, "original");
});

test("историческая заявка из диалога находит исходное сообщение", async () => {
  messages = [
    { ticketId: "ticket", attachMode: "origin", conversationId: "newer", sentAt: 2 },
    { ticketId: "ticket", attachMode: "origin", conversationId: "original", sentAt: 1 },
  ];
  assert.equal((await deliveryRoutes({ ...ticket, source: "Telegram" })).defaultRoute, "original");
});

test("исходный чат остаётся доступен за пределами 20 последних диалогов", async () => {
  tickets = [{ ...ticket, source: "Telegram", originConversationId: "original" }];
  conversations[0].lastMessage = { at: 1 };
  for (let index = 0; index < 20; index++) {
    conversations.push({ ...conversations[0], _id: `recent-${index}`, lastMessage: { at: index + 2 } });
  }
  const result = await deliveryRoutes(tickets[0]);
  assert.equal(result.defaultRoute, "original");
  assert.ok(result.routes.some((route) => route.conversationId === "original"));
});

test("сохранённый исходный чат доступен после отвязки и изменения контакта", async () => {
  tickets = [{ ...ticket, source: "Telegram", originConversationId: "original" }];
  identities = [];
  assert.equal((await deliveryRoutes(tickets[0])).defaultRoute, "original");
  conversations[0].hidden = true;
  assert.equal((await deliveryRoutes(tickets[0])).defaultRoute, "notify");
});

test("историческая заявка без исходных сообщений использует привязанный чат", async () => {
  conversations[0].binding = { ticketId: "ticket" };
  assert.equal((await deliveryRoutes({ ...ticket, source: "Telegram" })).defaultRoute, "original");
});

test("недоступный исходный чат не выбирается и не заменяется другим получателем", async () => {
  tickets = [{ ...ticket, source: "Telegram", originConversationId: "original" }];
  conversations[0].binding = { ticketId: "elsewhere", ticketNum: 42 };
  conversations.push({ ...conversations[0], _id: "another", binding: { ticketId: "ticket" } });
  tickets.push({ _id: "elsewhere", isClosed: false });
  const result = await deliveryRoutes(tickets[0]);
  assert.equal(result.defaultRoute, "notify");
  assert.equal(result.routes[0].available, false);
  assert.match(result.routes[0].reason, /42/);
});

test("чужие и скрытые чаты не становятся маршрутами заявки", async () => {
  conversations.push({ ...conversations[0], _id: "other-client", counterpartIdentityId: "stranger" });
  conversations.push({ ...conversations[0], _id: "hidden", hidden: true });
  assert.deepEqual((await deliveryRoutes(ticket)).routes.map((route) => route.conversationId), ["original"]);
});
