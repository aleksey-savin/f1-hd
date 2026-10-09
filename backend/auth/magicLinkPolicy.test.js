// node --test auth/magicLinkPolicy.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  MAGIC_LINK_VERIFY_PATH,
  mayReceiveMagicLink,
  refuseMagicLinkSession,
} = require("./magicLinkPolicy");

/**
 * Вход по ссылке из письма остаётся только клиентам без второго фактора
 * (D4 спеки W1): отправка молчит для всех остальных, а сеанс по ссылке
 * сотруднику и владельцу TOTP не выписывается.
 */

const client = (overrides = {}) => ({
  isEndUser: true,
  isServiceAccount: false,
  banned: false,
  twoFactorEnabled: false,
  company: { isActive: true },
  ...overrides,
});

const MINUTE = 60 * 1000;

test("an active client without a second factor gets the link", () => {
  assert.equal(mayReceiveMagicLink(client()), true);
  // Нет денормализованного статуса компании — активна (фильтры `$ne: false`)
  assert.equal(mayReceiveMagicLink(client({ company: undefined })), true);
  // Отключение со сроком после срока не действует (services/authBan)
  assert.equal(
    mayReceiveMagicLink(
      client({ banned: true, banExpires: new Date(Date.now() - MINUTE) }),
    ),
    true,
  );
});

test("nobody else gets one", () => {
  const refused = {
    "unknown address": null,
    staff: client({ isEndUser: false }),
    "no account type": client({ isEndUser: undefined }),
    "account type as a string": client({ isEndUser: "true" }),
    "service account": client({ isServiceAccount: true }),
    banned: client({ banned: true }),
    "banned until later": client({
      banned: true,
      banExpires: new Date(Date.now() + MINUTE),
    }),
    "company switched off": client({ company: { isActive: false } }),
    "second factor on": client({ twoFactorEnabled: true }),
  };
  for (const [label, user] of Object.entries(refused)) {
    assert.equal(mayReceiveMagicLink(user), false, label);
  }
});

test("a link session is refused to staff and to second-factor accounts", () => {
  assert.equal(MAGIC_LINK_VERIFY_PATH, "/magic-link/verify");

  for (const user of [
    { isEndUser: false, twoFactorEnabled: false },
    { isEndUser: true, twoFactorEnabled: true },
    { isEndUser: false, twoFactorEnabled: true },
  ]) {
    assert.match(
      refuseMagicLinkSession({ path: MAGIC_LINK_VERIFY_PATH, user }),
      /Ссылка из письма/,
      JSON.stringify(user),
    );
  }
});

test("a client without a second factor signs in by the link", () => {
  assert.equal(
    refuseMagicLinkSession({
      path: MAGIC_LINK_VERIFY_PATH,
      user: { isEndUser: true, twoFactorEnabled: false },
    }),
    null,
  );
  // Тип не записан — не сотрудник (accountAudienceOf); ссылку такой учётной
  // записи и не отправят
  assert.equal(
    refuseMagicLinkSession({ path: MAGIC_LINK_VERIFY_PATH, user: {} }),
    null,
  );
  // Учётной записи нет — отказывает sessionRefusal своим текстом
  assert.equal(
    refuseMagicLinkSession({ path: MAGIC_LINK_VERIFY_PATH, user: null }),
    null,
  );
});

test("other ways in are not this rule's business", () => {
  const staff = { isEndUser: false, twoFactorEnabled: true };
  for (const path of [
    "/sign-in/email",
    "/sign-in/email-otp",
    "/admin/impersonate-user",
    null,
    undefined,
  ]) {
    assert.equal(refuseMagicLinkSession({ path, user: staff }), null, String(path));
  }
});
