// node --test models/notification.test.js
require("module-alias/register");
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const Notification = require("./notification");

// Проверяется сам pre-save модели, без базы: хук зовётся напрямую
const KEYS = ["MAIL_MODE", "MAIL_SANDBOX_RECIPIENT"];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const preSave = async (fields) => {
  const doc = new Notification({ title: "Тема", text: "Текст", ...fields });
  await Notification.schema.s.hooks.execPre("save", doc, []);
  return doc;
};

const letter = () => ({ instrument: "email", to: { email: "a@b.c" } });

test("sandbox: адрес подменён, исходный сохранён", async () => {
  process.env.MAIL_MODE = "sandbox";
  process.env.MAIL_SANDBOX_RECIPIENT = "x@example.com";

  const doc = await preSave(letter());
  assert.equal(doc.to.email, "x@example.com");
  assert.equal(doc.intendedEmail, "a@b.c");
});

test("live: документ не меняется", async () => {
  process.env.MAIL_MODE = "live";

  const doc = await preSave(letter());
  assert.equal(doc.to.email, "a@b.c");
  assert.equal(doc.intendedEmail, null);
});

test("off (и не задано): адрес остаётся на месте, а не затирается", async () => {
  for (const mode of ["off", undefined]) {
    if (mode === undefined) delete process.env.MAIL_MODE;
    else process.env.MAIL_MODE = mode;

    const doc = await preSave(letter());
    assert.equal(doc.to.email, "a@b.c");
    assert.equal(doc.intendedEmail, null);
  }
});

test("sandbox: уведомление не по почте не трогается", async () => {
  process.env.MAIL_MODE = "sandbox";
  process.env.MAIL_SANDBOX_RECIPIENT = "x@example.com";

  const doc = await preSave({ instrument: "telegram", to: { email: "a@b.c" } });
  assert.equal(doc.to.email, "a@b.c");
});
