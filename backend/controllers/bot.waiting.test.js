require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const ticketPath = require.resolve("@/models/ticket");
const ticketModule = new Module(ticketPath);
Object.assign(ticketModule, { loaded: true, exports: { Ticket: {} } });
require.cache[ticketPath] = ticketModule;
const Notification = require("@/models/notification");
const Conversation = require("@/models/conversation");
const Preferences = require("@/models/preferences");
const User = require("@/models/user");
const controller = require("./bot");
const since = new Date("2026-11-12T01:00:00Z");
const id = "64f600000000000000000001";

const pull = async (t, notices) => {
  let payload;
  const all = [...notices];
  t.mock.method(Notification, "findOneAndUpdate", async () => notices.shift() || null);
  t.mock.method(Notification, "updateOne", async (filter, change) => Object.assign(all.find((notice) => String(notice._id) === String(filter._id)), change.$set));
  t.mock.method(User, "exists", async () => null);
  await controller.outboxPull({ query: {} }, { status() { return this; }, json(value) { payload = value; } }, (error) => { throw error; });
  return payload.notifications;
};

test("answered waiting alert is dropped before bot delivery while an ordinary comment still goes through", async (t) => {
  t.mock.method(Preferences, "findOne", () => ({ select() { return this; }, lean: async () => ({ modules: { messaging: { isActive: true } }, notify: { byTelegram: { isActive: true } } }) }));
  t.mock.method(Conversation, "exists", async () => null);
  const waiting = new Notification({ instrument: "telegram", to: { chatId: "staff" }, conversationWait: { conversationId: id, awaitingSince: since } });
  const ordinary = new Notification({ instrument: "telegram", to: { chatId: "other" }, text: "Обычный комментарий" });
  const delivered = await pull(t, [waiting, ordinary]);
  assert.deepEqual(delivered.map((notice) => notice.chatId), ["other"]);
  assert.equal(waiting.failed, true);
});

test("current waiting alert can be delivered", async (t) => {
  t.mock.method(Preferences, "findOne", () => ({ select() { return this; }, lean: async () => ({ modules: { messaging: { isActive: true } }, notify: { byTelegram: { isActive: true } } }) }));
  t.mock.method(Conversation, "exists", async (filter) => {
    assert.equal(String(filter._id), id);
    assert.equal(+filter.awaitingSince, +since);
    return { _id: id };
  });
  const waiting = new Notification({ instrument: "telegram", to: { chatId: "staff" }, conversationWait: { conversationId: id, awaitingSince: since } });
  assert.equal((await pull(t, [waiting])).length, 1);
});

test("ordinary comment delivery does not consult the Dialogues module or conversations", async (t) => {
  t.mock.method(Preferences, "findOne", () => { throw new Error("ordinary comments must not depend on Dialogues settings"); });
  t.mock.method(Conversation, "exists", () => { throw new Error("ordinary comments must not depend on a conversation"); });
  const ordinary = new Notification({ instrument: "telegram", to: { chatId: "other" }, text: "Обычный комментарий" });
  assert.equal((await pull(t, [ordinary])).length, 1);
});
