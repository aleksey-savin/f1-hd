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
let conversations, identities, channels, tickets, messages, comments, users;
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
stub("@/models/user", { findById: (id) => query(users.filter((user) => user._id === String(id)), true) });
const { deliveryRoutes } = require("./origin");

const ticket = { _id: "ticket", applicantId: "client", source: "Вручную" };
beforeEach(() => {
  identities = [{ _id: "identity", userId: "client" }];
  channels = [{ _id: "channel", type: "telegram", isActive: true }];
  conversations = [{ _id: "original", channelId: "channel", network: "telegram", kind: "direct", counterpartIdentityId: "identity" }];
  tickets = [ticket];
  messages = [];
  comments = [];
  users = [{ _id: "client", firstName: "Алексей", phone: "" }];
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

test("старая обычная заявка без чатов и identities предлагает первый контакт по номеру во всех мессенджерах", async () => {
  conversations = [];
  identities = [];
  users[0].phone = "+7 (914) 555-01-42";
  channels = [
    { _id: "tg", type: "telegram", provider: "wazzup", providerTransport: "tgapi", isActive: true },
    { _id: "wa", type: "whatsapp", provider: "wazzup", providerTransport: "whatsapp", isActive: true },
    { _id: "max", type: "max", provider: "wazzup", providerTransport: "max", isActive: true },
  ];
  const result = await deliveryRoutes(ticket);
  assert.deepEqual(result.routes.map((route) => [route.id, route.target, route.conversationId, route.available]), [
    ["phone:tg", "phone", null, true], ["phone:wa", "phone", null, true], ["phone:max", "phone", null, true],
  ]);
  assert.equal(result.defaultRoute, "notify");
});

test("бот, отключённый канал и отсутствие номера не обещают первый контакт", async () => {
  conversations = [];
  channels = [{ _id: "tg", type: "telegram", provider: "wazzup", providerTransport: "telegram", isActive: true },
    { _id: "off", type: "whatsapp", provider: "wazzup", providerTransport: "whatsapp", isActive: false }];
  users[0].phone = "79145550142";
  let result = await deliveryRoutes(ticket);
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].available, false);
  assert.match(result.routes[0].reason, /первым/);
  channels[0].providerTransport = "tgapi";
  users[0].phone = "";
  result = await deliveryRoutes(ticket);
  assert.equal(result.routes[0].available, false);
  assert.match(result.routes[0].reason, /номер/);
});

test("исторические чаты одного номера и канала имеют разные id маршрутов", async () => {
  users[0].phone = "79145550142";
  conversations[0].deliveryPhone = "79145550142";
  conversations.push({ ...conversations[0], _id: "another-chat" });
  const result = await deliveryRoutes(ticket);
  assert.deepEqual(result.routes.map((route) => route.id), ["original", "another-chat"]);
  assert.equal(new Set(result.routes.map((route) => route.id)).size, result.routes.length);
});

test("доступный личный Telegram не дублируется недоступным первым сообщением через другое подключение", async () => {
  users[0].phone = "79145550142";
  channels.push(
    { _id: "legacy-tg", type: "telegram", provider: "gateway", isActive: true },
    { _id: "wa", type: "whatsapp", provider: "wazzup", providerTransport: "whatsapp", isActive: true },
  );
  const result = await deliveryRoutes(ticket);
  assert.deepEqual(result.routes.map((route) => route.id), ["original", "phone:wa"]);
});

test("доступный первый контакт не дублируется недоступным подключением той же сети", async () => {
  conversations = [];
  users[0].phone = "79145550142";
  channels = [
    { _id: "legacy-tg", type: "telegram", provider: "gateway", isActive: true },
    { _id: "tg", type: "telegram", provider: "wazzup", providerTransport: "tgapi", isActive: true },
  ];
  assert.deepEqual((await deliveryRoutes(ticket)).routes.map((route) => route.id), ["phone:tg"]);
});

test("группа не заменяет личную переписку: причина недоступности первого контакта сохраняется", async () => {
  conversations[0].kind = "group";
  users[0].phone = "79145550142";
  const result = await deliveryRoutes(ticket);
  assert.equal(result.routes.length, 2);
  assert.equal(result.routes[0].available, true);
  assert.equal(result.routes[1].target, "phone");
  assert.equal(result.routes[1].available, false);
  assert.match(result.routes[1].reason, /недоступно/);
});
