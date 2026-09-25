// node --test services/messaging/events.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { validateEvent } = require("./events");

const CHANNEL = "66f2a1b2c3d4e5f6a7b8c9d0";
const message = (overrides = {}) => ({
  type: "message",
  channelId: CHANNEL,
  chat: { id: "123456", kind: "direct", peer: { id: "123456", name: "Марина Соколова", username: "m_sokolova" } },
  message: {
    id: "9001",
    direction: "in",
    sender: { id: "123456", name: "Марина Соколова", username: "m_sokolova" },
    kind: "text",
    text: "Доброе утро!",
    sentAt: "2026-09-24T09:58:00.000Z",
  },
  ...overrides,
});

test("a well-formed message passes and gets defaults", () => {
  const result = validateEvent(message());
  assert.equal(result.ok, true);
  assert.equal(result.event.message.imported, false);
  assert.equal(result.event.message.sentAt instanceof Date, true);
  assert.deepEqual(result.event.message.attachments, []);
});

test("required fields are required", () => {
  assert.equal(validateEvent({ ...message(), channelId: "nope" }).ok, false);
  assert.equal(validateEvent({ ...message(), type: "message.weird" }).ok, false);
  assert.equal(validateEvent(message({ chat: { id: "", kind: "direct" } })).ok, false);
  assert.equal(validateEvent(message({ chat: { id: "1", kind: "channel" } })).ok, false);
  const noId = message();
  delete noId.message.id;
  assert.equal(validateEvent(noId).ok, false);
  const badDate = message();
  badDate.message.sentAt = "yesterday";
  assert.equal(validateEvent(badDate).ok, false);
});

test("an inbound message needs a sender, an outbound one does not", () => {
  const inbound = message();
  delete inbound.message.sender;
  assert.equal(validateEvent(inbound).ok, false);
  const outbound = message();
  outbound.message.direction = "out";
  outbound.message.origin = "device";
  delete outbound.message.sender;
  assert.equal(validateEvent(outbound).ok, true);
});

test("origin hd needs the job id; unknown origins are refused", () => {
  const own = message();
  own.message.direction = "out";
  own.message.origin = "hd";
  assert.equal(validateEvent(own).ok, false);
  own.message.jobId = "66f2a1b2c3d4e5f6a7b8c9d1";
  assert.equal(validateEvent(own).ok, true);
  const weird = message();
  weird.message.origin = "martian";
  assert.equal(validateEvent(weird).ok, false);
});

test("limits: text 20 000, 20 attachments, 100 deleted ids", () => {
  const long = message();
  long.message.text = "x".repeat(20_001);
  assert.equal(validateEvent(long).ok, false);
  const many = message();
  many.message.attachments = Array.from({ length: 21 }, (_, i) => ({ name: `f${i}` }));
  assert.equal(validateEvent(many).ok, false);
  const deleted = { type: "message.deleted", channelId: CHANNEL, messageIds: Array.from({ length: 101 }, (_, i) => String(i)) };
  assert.equal(validateEvent(deleted).ok, false);
});

test("edits, deletions, statuses, chats and channel states", () => {
  assert.equal(
    validateEvent({ type: "message.edited", channelId: CHANNEL, chat: { id: "1" }, message: { id: "9", text: "исправил", editedAt: "2026-09-24T10:00:00Z" } }).ok,
    true,
  );
  // в личных чатах Telegram удаление приходит без чата — это нормально
  assert.equal(validateEvent({ type: "message.deleted", channelId: CHANNEL, messageIds: ["9", "10"] }).ok, true);
  assert.equal(validateEvent({ type: "message.status", channelId: CHANNEL, jobId: "66f2a1b2c3d4e5f6a7b8c9d1", status: "delivered" }).ok, true);
  assert.equal(validateEvent({ type: "message.status", channelId: CHANNEL, status: "delivered" }).ok, false);
  assert.equal(validateEvent({ type: "message.status", channelId: CHANNEL, chat: { id: "1" }, messageIds: ["9"], status: "lost" }).ok, false);
  assert.equal(validateEvent({ type: "chat", channelId: CHANNEL, chat: { id: "-100", kind: "group", title: "ТД Восток × F1Lab" } }).ok, true);
  assert.equal(validateEvent({ type: "channel.state", channelId: CHANNEL, state: "connected", account: { displayName: "F1Lab Поддержка" } }).ok, true);
  assert.equal(validateEvent({ type: "channel.state", channelId: CHANNEL, state: "sleepy" }).ok, false);
});
