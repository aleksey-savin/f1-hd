// node --test services/mcp/requester.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { pickRequester, TELEGRAM_ID } = require("./requester");

const staff = (overrides = {}) => ({
  _id: "u1",
  isEndUser: false,
  isServiceAccount: false,
  telegramBot: { chatId: "1001", isActive: true },
  ...overrides,
});
const notBanned = () => false;

test("one active staff member with this Telegram id is the requester", () => {
  assert.equal(pickRequester([staff()], "1001", notBanned)._id, "u1");
});

test("nobody, a client, a service account, an inactive bot or a banned person is not a requester", () => {
  assert.equal(pickRequester([], "1001", notBanned), null);
  assert.equal(pickRequester([staff({ isEndUser: true })], "1001", notBanned), null);
  assert.equal(pickRequester([staff({ isServiceAccount: true })], "1001", notBanned), null);
  assert.equal(pickRequester([staff({ telegramBot: { chatId: "1001", isActive: false } })], "1001", notBanned), null);
  assert.equal(pickRequester([staff()], "1001", () => true), null);
});

test("a Telegram id shared by two staff members is refused, not guessed", () => {
  const picked = pickRequester([staff(), staff({ _id: "u2" })], "1001", notBanned);
  assert.equal(picked.error, "more than one employee has this Telegram id");
});

test("a number-typed chat id in the database still matches", () => {
  assert.equal(pickRequester([staff({ telegramBot: { chatId: 1001, isActive: true } })], "1001", notBanned)._id, "u1");
});

test("only digits are a Telegram id", () => {
  assert.equal(TELEGRAM_ID.test("1001"), true);
  assert.equal(TELEGRAM_ID.test("-1001"), false);
  assert.equal(TELEGRAM_ID.test("1001; drop"), false);
});
