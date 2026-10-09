// node --test services/selfAccountFields.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { pickSelfEditableFields } = require("./selfAccountFields");

/**
 * «Мой аккаунт» правит профиль, а не доступ: свой email и свои разделы базы
 * знаний человек больше не меняет (спека W1, §2).
 */

const PROFILE = {
  firstName: "Мария",
  lastName: "Иванова",
  phone: "79145550142",
  position: "Инженер поддержки",
  notify: { byEmail: { ticketUpdate: false } },
  telegramBot: { chatId: "", isActive: false },
  timezone: "Asia/Vladivostok",
  fontScale: 125,
  plainCanvas: true,
};

test("own profile fields pass as sent", () => {
  assert.deepEqual(pickSelfEditableFields(PROFILE), PROFILE);
});

test("e-mail and knowledge-base categories are dropped", () => {
  const picked = pickSelfEditableFields({
    ...PROFILE,
    email: "someone-else@example.com",
    categories: ["66aa00000000000000000001"],
  });

  assert.equal(Object.hasOwn(picked, "email"), false);
  assert.equal(Object.hasOwn(picked, "categories"), false);
  assert.deepEqual(picked, PROFILE);
});

test("access fields never pass", () => {
  assert.deepEqual(
    pickSelfEditableFields({
      id: "66aa00000000000000000002",
      banned: false,
      isEndUser: false,
      isAdmin: true,
      isServiceAccount: false,
      role: "impersonator",
      roles: ["admin"],
      company: "66aa00000000000000000003",
      password: "x",
    }),
    {},
  );
});

test("a field that was not sent stays absent; empty values pass", () => {
  assert.deepEqual(pickSelfEditableFields({}), {});
  assert.deepEqual(pickSelfEditableFields(undefined), {});
  // Пустой телефон — «телефона нет», null пояса — «как у организации»
  assert.deepEqual(pickSelfEditableFields({ phone: "", timezone: null }), {
    phone: "",
    timezone: null,
  });
});

test("inherited keys are not picked", () => {
  const body = Object.create({ email: "x@example.com", firstName: "Чужое" });
  assert.deepEqual(pickSelfEditableFields(body), {});
});
