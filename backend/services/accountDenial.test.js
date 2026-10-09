// node --test services/accountDenial.test.js
//
// Основания отказать учётной записи (services/accountDenial): правило одно на
// браузер, Телеграм и ответ письмом в заявку. Модуль без зависимостей, поэтому
// прямые случаи идут обычным `node --test`, без module-alias; он нужен только
// последнему тесту, который грузит настоящие authBan и authContext.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isBanned, isDeniedAccount } = require("./accountDenial");

const DAY = 24 * 60 * 60 * 1000;
const inFuture = () => new Date(Date.now() + DAY);
const inPast = () => new Date(Date.now() - DAY);

// Действующая учётная запись; поля, о которых речь, переопределяются
const account = (fields = {}) => ({
  banned: false,
  isServiceAccount: false,
  company: { isActive: true },
  ...fields,
});

test("isBanned: a ban without an expiry holds", () => {
  assert.equal(isBanned({ banned: true }), true);
  assert.equal(isBanned({ banned: true, banExpires: null }), true);
});

test("isBanned: a ban holds until its expiry, after that it is lifted", () => {
  assert.equal(isBanned({ banned: true, banExpires: inFuture() }), true);
  // Флаг в документе после срока ещё стоит — его снимает расписание, а до тех
  // пор отключением считается только то, у чего срок не вышел
  assert.equal(isBanned({ banned: true, banExpires: inPast() }), false);
});

test("isBanned: no flag and no document is no ban", () => {
  assert.equal(isBanned({ banned: false }), false);
  assert.equal(isBanned({}), false);
  assert.equal(isBanned(undefined), false);
  assert.equal(isBanned(null), false);
  // Срок без флага ничего не значит
  assert.equal(isBanned({ banned: false, banExpires: inFuture() }), false);
});

test("isDeniedAccount: a clean account is not denied", () => {
  assert.equal(isDeniedAccount(account()), false);
  // Статус компании ещё не записан в учётку — компания считается действующей
  assert.equal(isDeniedAccount(account({ company: {} })), false);
  assert.equal(isDeniedAccount(account({ company: undefined })), false);
  assert.equal(isDeniedAccount(account({ company: null })), false);
});

test("isDeniedAccount: a ban without an expiry or with one ahead denies", () => {
  assert.equal(isDeniedAccount(account({ banned: true })), true);
  assert.equal(
    isDeniedAccount(account({ banned: true, banExpires: inFuture() })),
    true,
  );
});

test("isDeniedAccount: a ban whose expiry has passed does not deny", () => {
  assert.equal(
    isDeniedAccount(account({ banned: true, banExpires: inPast() })),
    false,
  );
});

test("isDeniedAccount: a switched-off company denies", () => {
  assert.equal(
    isDeniedAccount(account({ company: { isActive: false } })),
    true,
  );
});

test("isDeniedAccount: a service account denies", () => {
  assert.equal(isDeniedAccount(account({ isServiceAccount: true })), true);
});

test("authBan and authContext hand out the very same functions", () => {
  // Проект ходит за ними по прежним путям — isBanned из authBan,
  // isDeniedAccount из authContext: там должен лежать тот же код, а не копия,
  // иначе правил снова станет два
  require("module-alias/register");
  const authBan = require("@/services/authBan");
  const authContext = require("@/services/authContext");

  assert.equal(authBan.isBanned, isBanned);
  assert.equal(authContext.isDeniedAccount, isDeniedAccount);
});
