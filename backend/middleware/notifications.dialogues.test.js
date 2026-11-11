require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
// The ticket module starts a database counter at import. All persistence in
// these producer regressions is isolated at the model boundary.
const ticketPath = require.resolve("@/models/ticket");
const ticketModule = new Module(ticketPath);
ticketModule.loaded = true;
ticketModule.exports = { Ticket: { findById() {} } };
require.cache[ticketPath] = ticketModule;
const { Ticket } = ticketModule.exports;
const Notification = require("@/models/notification");
const Comment = require("@/models/comment");
const Preferences = require("@/models/preferences");
const User = require("@/models/user");
const InAppNotification = require("@/models/inAppNotification");
const { createCommentNotifications } = require("./notifications");

const query = (value) => ({
  sort() { return this; }, limit() { return this; }, populate() { return this; }, select() { return this; },
  lean: async () => value,
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});
const person = (id) => ({
  _id: id, firstName: id, lastName: "Тест", email: `${id}@example.test`,
  telegramBot: { isActive: true, chatId: id },
  notify: { byTelegram: { ticketNewComment: true }, byEmail: { ticketNewComment: true } },
});
const users = [person("applicant"), person("responsible"), person("author")];
const ticket = { _id: "ticket", num: 42, title: "Принтер", applicantId: "applicant", responsibles: [{ _id: "responsible" }] };
const prefs = { notify: {
  byTelegram: { isActive: true, sendToGroup: true, chatId: "team", messageThreadId: "17" },
  byEmail: { isActive: true }, personal: { ticketNewComment: true },
} };

const produce = async (t, extra = {}) => {
  const queued = [], bell = [];
  const comment = {
    _id: "comment", ticketId: "ticket", content: "Текст", createdBy: users[2],
    notifications: { lastAction: "new comment", pending: true },
    async save() {}, ...extra,
  };
  t.mock.method(Preferences, "findOne", () => query(prefs));
  t.mock.method(Comment, "find", () => query([comment]));
  t.mock.method(Ticket, "findById", async () => ticket);
  t.mock.method(User, "findById", async (id) => users.find((user) => user._id === id));
  t.mock.method(User, "find", () => query(users));
  t.mock.method(Notification.prototype, "save", async function () { queued.push(this.toObject()); });
  t.mock.method(InAppNotification, "insertMany", async (items) => { bell.push(...items); return items; });
  await createCommentNotifications();
  assert.equal(comment.notifications.pending, false);
  return { queued, bell };
};

for (const [label, extra] of [
  ["ordinary ticket comment", {}],
  ["comment arriving by email", { source: "email" }],
  ["ticket-page reply delivered by messenger", { channel: { network: "telegram", direction: "out", conversationId: "dialog" } }],
]) {
  test(`${label} retains personal, group, email and bell notifications`, async (t) => {
    const { queued, bell } = await produce(t, extra);
    const telegram = queued.filter((notice) => notice.instrument === "telegram");
    assert.deepEqual(telegram.map((notice) => notice.to.chatId).sort(), ["applicant", "responsible", "team"]);
    assert.equal(telegram.find((notice) => notice.to.globalChat).to.messageThreadId, "17");
    assert.equal(queued.filter((notice) => notice.instrument === "email").length, 2);
    assert.equal(bell.length, 2);
  });
}

for (const direction of ["in", "out"]) {
  test(`Dialogues ${direction} comment does not produce per-message Telegram copies`, async (t) => {
    const { queued, bell } = await produce(t, {
      channel: { network: "max", direction, conversationId: "dialog" },
      notifications: { lastAction: "new comment", pending: true, fromConversation: true },
    });
    assert.equal(queued.filter((notice) => notice.instrument === "telegram").length, 0);
    assert.equal(queued.filter((notice) => notice.instrument === "email").length, 2);
    assert.equal(bell.length, 2);
  });
}

test("pending inbound mirrors from before the update do not replay Telegram spam", async (t) => {
  const { queued } = await produce(t, { channel: { network: "telegram", direction: "in", conversationId: "dialog" } });
  assert.equal(queued.filter((notice) => notice.instrument === "telegram").length, 0);
});
