// node --test services/invitation.test.js
require("module-alias/register");
const Module = require("node:module");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

/**
 * Вход по ссылке по HTTP закрыт (middleware/authPathAllowList.js: POST
 * /api/auth/sign-in/magic-link отвечает 404), поэтому единственный путь, которым
 * клиенту выписывается ссылка, — приглашение: `auth.api.signInMagicLink`, вызванный
 * внутри процесса, мимо HTTP-роутера и его списка. Тесты держат именно это: ссылка
 * по-прежнему выписывается, и выписывает её серверный вызов, а не запрос к ручке.
 *
 * Настоящий better-auth собирается на открытом соединении с MongoDB
 * (auth/bootstrap.initAuth), а базы в тестах нет, поэтому инстанс подставлен
 * заглушкой с теми же методами `api.*`; проверяется, что и с чем зовёт
 * приглашение, а не сам плагин. Коллекция проверок (`authVerifications`), в которой
 * срок ссылки продлевается до двух суток, — тоже заглушка поверх
 * `mongoose.connection.db`.
 */

const bootstrapPath = require.resolve("@/auth/bootstrap");
const calls = { signInMagicLink: [], requestPasswordReset: [] };
const fakeAuth = {
  api: {
    signInMagicLink: async (args) => {
      calls.signInMagicLink.push(args);
      return { status: true };
    },
    requestPasswordReset: async (args) => {
      calls.requestPasswordReset.push(args);
      return { status: true };
    },
  },
};
const bootstrapStub = new Module(bootstrapPath);
bootstrapStub.filename = bootstrapPath;
bootstrapStub.loaded = true;
bootstrapStub.exports = {
  getAuth: () => fakeAuth,
  // Как настоящий fromNodeHeaders: заголовки Node превращаются в Headers
  getFromNodeHeaders: () => (headers) => new Headers(headers),
};
require.cache[bootstrapPath] = bootstrapStub;

const logger = require("@/utils/logger");
const { invite, INVITE_TTL_MS } = require("./invitation");

// Коллекция authVerifications: findOne-цепочка отдаёт свежую строку, updateOne
// записывается. Расходится с настоящей только тем, что ничего не ищет по значению.
const stubVerifications = (t, rows) => {
  const updates = [];
  const original = mongoose.connection.db;
  mongoose.connection.db = {
    collection(name) {
      assert.equal(name, "authVerifications");
      return {
        find: () => ({
          sort: () => ({ limit: () => ({ next: async () => rows[0] ?? null }) }),
        }),
        updateOne: async (filter, update) => {
          updates.push({ filter, update });
          return { acknowledged: true };
        },
      };
    },
  };
  t.after(() => {
    mongoose.connection.db = original;
  });
  return updates;
};

// Только что заведённая учётка: save считается, в базу не идёт
const newUser = (fields) => ({
  email: "client@example.ru",
  isEndUser: true,
  twoFactorEnabled: false,
  saved: 0,
  async save() {
    this.saved += 1;
  },
  ...fields,
});

const request = { headers: { host: "hd.example.ru", "user-agent": "node-test" } };

test("приглашение клиента выписывает ссылку внутри процесса: auth.api.signInMagicLink, а не ручка", async (t) => {
  calls.signInMagicLink.length = 0;
  calls.requestPasswordReset.length = 0;
  const verificationId = new mongoose.Types.ObjectId();
  const updates = stubVerifications(t, [{ _id: verificationId }]);
  t.mock.method(logger, "log", () => {});
  const user = newUser({});
  const before = Date.now();

  const sent = await invite(user, request);

  assert.equal(sent, true, "письмо не ушло");
  assert.equal(calls.signInMagicLink.length, 1, "ссылка не выписана");
  assert.deepEqual(calls.requestPasswordReset, [], "клиенту ушёл сброс пароля");
  const [{ body, headers }] = calls.signInMagicLink;
  assert.deepEqual(body, { email: "client@example.ru", callbackURL: "/" });
  // Заголовки запроса доходят: better-auth берёт из них адрес сервера для ссылки
  assert.ok(headers instanceof Headers);
  assert.equal(headers.get("host"), "hd.example.ru");

  // Срок ссылки продлён до двух суток: плагин на вызов своё значение не принимает
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].filter, { _id: verificationId });
  const expiresAt = updates[0].update.$set.expiresAt.getTime();
  assert.ok(expiresAt >= before + INVITE_TTL_MS && expiresAt <= Date.now() + INVITE_TTL_MS);
  assert.equal(INVITE_TTL_MS, 48 * 60 * 60 * 1000);

  // Приглашение учтено
  assert.ok(user.invitedAt instanceof Date);
  assert.equal(user.saved, 1);
});

test("сотрудник и клиент со вторым фактором получают сброс пароля, а не ссылку", async (t) => {
  t.mock.method(logger, "log", () => {});
  stubVerifications(t, []);

  for (const fields of [
    { isEndUser: false },
    { isEndUser: true, twoFactorEnabled: true },
  ]) {
    calls.signInMagicLink.length = 0;
    calls.requestPasswordReset.length = 0;

    assert.equal(await invite(newUser(fields), request), true, JSON.stringify(fields));
    assert.deepEqual(calls.signInMagicLink, [], `ссылка ушла: ${JSON.stringify(fields)}`);
    assert.equal(calls.requestPasswordReset.length, 1, JSON.stringify(fields));
    assert.deepEqual(calls.requestPasswordReset[0].body, { email: "client@example.ru" });
  }
});
