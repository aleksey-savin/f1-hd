// node --test auth/bootstrap.test.js
// Загрузка bootstrap.js ничего не открывает: подключение к Mongo и сборка
// better-auth происходят только в initAuth(), которого тест не вызывает.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isAuthReady } = require("./bootstrap");

test("до initAuth() better-auth не готов: кроны ждут его, как и базу", () => {
  assert.equal(isAuthReady(), false);
});
