require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Notification = require("@/models/notification");
const User = require("@/models/user");
const controller = require("./bot");

test("Telegram outbox drops queued personal messages after their account is deleted", async () => {
  const old = { claim: Notification.findOneAndUpdate, update: Notification.updateOne, exists: User.exists };
  const notice = { _id: "notice", to: { chatId: "123", applicant: "Former employee" }, sent: false, failed: false };
  let seen = false;
  let sent;
  try {
    Notification.findOneAndUpdate = async () => seen ? null : (seen = true, notice);
    Notification.updateOne = async (_query, patch) => Object.assign(notice, patch.$set);
    User.exists = async () => ({ _id: "deleted" });
    await controller.outboxPull({ query: {} }, { status() { return this; }, json(payload) { sent = payload; } }, (error) => { throw error; });
    assert.deepEqual(sent.notifications, []);
    assert.equal(notice.failed, true);
  } finally { Notification.findOneAndUpdate = old.claim; Notification.updateOne = old.update; User.exists = old.exists; }
});
