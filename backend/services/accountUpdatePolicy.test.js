// node --test services/accountUpdatePolicy.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  planAccountUpdate,
  emailChangedNotice,
  ACCOUNT_UPDATE_MESSAGES,
} = require("./accountUpdatePolicy");

/**
 * Правка карточки человека: email, отключение и тип учётной записи — это
 * доступ. Проверяется решение без базы; запись, погашение сеансов и письмо
 * делает контроллер (controllers/user.js#update).
 */

const TARGET = { email: "ivanov@f1lab.ru", banned: false, isEndUser: true };

const plan = (
  body,
  { target = TARGET, mayManageAccess = true, mayBan = true } = {},
) => planAccountUpdate({ target, body, mayManageAccess, mayBan });

test("fields that are not sent are left alone", () => {
  assert.deepEqual(plan({}), {
    refusal: null,
    emailChange: null,
    banned: undefined,
    isEndUser: undefined,
    audienceChanged: false,
  });
  // Пропущенный флаг больше не включает отключённую учётку
  assert.equal(plan({}, { target: { ...TARGET, banned: true } }).banned, undefined);
});

test("the same address in another case or with spaces is not a change", () => {
  const result = plan({ email: "  Ivanov@F1LAB.ru " }, { mayManageAccess: false });

  assert.equal(result.refusal, null);
  assert.equal(result.emailChange, null);
});

test("changing the e-mail needs user.manageAccess", () => {
  const refused = plan({ email: "petrov@f1lab.ru" }, { mayManageAccess: false });
  assert.deepEqual(refused.refusal, {
    status: 403,
    message: ACCOUNT_UPDATE_MESSAGES.emailRight,
  });
  assert.equal(refused.emailChange, null);

  const allowed = plan({ email: " Petrov@F1lab.ru" });
  assert.equal(allowed.refusal, null);
  assert.deepEqual(allowed.emailChange, {
    from: "ivanov@f1lab.ru",
    to: "petrov@f1lab.ru",
  });
});

test("a malformed e-mail is a 400 whatever the rights", () => {
  for (const email of [
    "",
    "   ",
    "petrov@f1lab",
    "not an address",
    null,
    42,
    { $ne: "" },
    ["petrov@f1lab.ru"],
  ]) {
    const result = plan({ email });
    assert.equal(result.refusal?.status, 400, JSON.stringify(email));
    assert.equal(result.emailChange, null);
  }
  assert.equal(plan({ email: "" }).refusal.message, ACCOUNT_UPDATE_MESSAGES.emailEmpty);
});

test("the ban flag changes only on a different value", () => {
  assert.equal(plan({ banned: false }).banned, undefined);
  assert.equal(
    plan({ banned: true }, { target: { ...TARGET, banned: true } }).banned,
    undefined,
  );
  assert.equal(plan({ banned: true }).banned, true);
  assert.equal(
    plan({ banned: false }, { target: { ...TARGET, banned: true } }).banned,
    false,
  );
  // Поля нет в документе — «работает»: присланное false изменением не считается
  assert.equal(
    plan({ banned: false }, { target: { email: TARGET.email } }).banned,
    undefined,
  );
});

test("a ban change needs the ban right; an unchanged flag does not", () => {
  assert.deepEqual(plan({ banned: true }, { mayBan: false }).refusal, {
    status: 403,
    message: ACCOUNT_UPDATE_MESSAGES.banRight,
  });
  assert.equal(plan({ banned: false }, { mayBan: false }).refusal, null);
});

test("the ban flag and the account type must be booleans", () => {
  for (const value of ["true", "false", 1, 0, null, {}]) {
    assert.equal(
      plan({ banned: value }).refusal?.status,
      400,
      `banned=${JSON.stringify(value)}`,
    );
    assert.equal(
      plan({ isEndUser: value }).refusal?.status,
      400,
      `isEndUser=${JSON.stringify(value)}`,
    );
  }
});

test("isEndUser is applied as sent and reports an audience flip", () => {
  const flipped = plan({ isEndUser: false });
  assert.equal(flipped.isEndUser, false);
  assert.equal(flipped.audienceChanged, true);

  const same = plan({ isEndUser: true });
  assert.equal(same.isEndUser, true);
  assert.equal(same.audienceChanged, false);

  // Тип не записан — это клиент (accountAudienceOf)
  const untyped = { email: TARGET.email };
  assert.equal(plan({ isEndUser: true }, { target: untyped }).audienceChanged, false);
  assert.equal(plan({ isEndUser: false }, { target: untyped }).audienceChanged, true);
});

test("changing the account type needs user.manageAccess", () => {
  // Клиент → сотрудник
  const refused = plan({ isEndUser: false }, { mayManageAccess: false });
  assert.deepEqual(refused.refusal, {
    status: 403,
    message: ACCOUNT_UPDATE_MESSAGES.typeRight,
  });
  assert.match(ACCOUNT_UPDATE_MESSAGES.typeRight, /менять тип учётной записи/);
  // Отказ не оставляет планов: ни записи типа, ни пересчёта ролей
  assert.equal(refused.isEndUser, undefined);
  assert.equal(refused.audienceChanged, false);

  // Сотрудник → клиент — тоже смена
  const staff = { ...TARGET, isEndUser: false };
  assert.equal(
    plan({ isEndUser: true }, { target: staff, mayManageAccess: false }).refusal
      ?.status,
    403,
  );

  // Право то же, что у смены email: право отключения тут ничего не решает
  const allowed = plan({ isEndUser: false }, { mayManageAccess: true, mayBan: false });
  assert.equal(allowed.refusal, null);
  assert.equal(allowed.isEndUser, false);
  assert.equal(allowed.audienceChanged, true);
  assert.equal(
    plan({ isEndUser: false }, { mayManageAccess: false, mayBan: true }).refusal
      ?.status,
    403,
  );

  // Кривое значение — 400 и без права: форма раньше права
  assert.deepEqual(
    plan({ isEndUser: "false" }, { mayManageAccess: false }).refusal,
    { status: 400, message: ACCOUNT_UPDATE_MESSAGES.isEndUser },
  );
});

test("the same account type, or none sent, needs no right", () => {
  const noRights = { mayManageAccess: false, mayBan: false };

  // Форма шлёт тип и тогда, когда его не трогали: то же значение — не смена
  const sameClient = plan({ isEndUser: true }, noRights);
  assert.equal(sameClient.refusal, null);
  assert.equal(sameClient.isEndUser, true);
  assert.equal(sameClient.audienceChanged, false);

  const staff = { ...TARGET, isEndUser: false };
  const sameStaff = plan({ isEndUser: false }, { ...noRights, target: staff });
  assert.equal(sameStaff.refusal, null);
  assert.equal(sameStaff.isEndUser, false);
  assert.equal(sameStaff.audienceChanged, false);

  // Тип не прислан — тоже без права
  const omitted = plan({}, noRights);
  assert.equal(omitted.refusal, null);
  assert.equal(omitted.isEndUser, undefined);
});

test("an account with no stored type is a client: true is no change, false is", () => {
  const untyped = { email: TARGET.email };

  const same = plan({ isEndUser: true }, { target: untyped, mayManageAccess: false });
  assert.equal(same.refusal, null);
  assert.equal(same.audienceChanged, false);

  assert.equal(
    plan({ isEndUser: false }, { target: untyped, mayManageAccess: false }).refusal
      ?.status,
    403,
  );
  assert.equal(plan({ isEndUser: false }, { target: untyped }).refusal, null);
});

test("form errors come before permission errors", () => {
  const result = plan(
    { isEndUser: "yes", email: "petrov@f1lab.ru", banned: true },
    { mayManageAccess: false, mayBan: false },
  );
  assert.deepEqual(result.refusal, {
    status: 400,
    message: ACCOUNT_UPDATE_MESSAGES.isEndUser,
  });
});

test("rights are refused in order: e-mail, account type, ban", () => {
  const noRights = { mayManageAccess: false, mayBan: false };

  assert.equal(
    plan({ email: "petrov@f1lab.ru", isEndUser: false, banned: true }, noRights)
      .refusal.message,
    ACCOUNT_UPDATE_MESSAGES.emailRight,
  );
  assert.equal(
    plan({ isEndUser: false, banned: true }, noRights).refusal.message,
    ACCOUNT_UPDATE_MESSAGES.typeRight,
  );
  assert.equal(
    plan({ banned: true }, noRights).refusal.message,
    ACCOUNT_UPDATE_MESSAGES.banRight,
  );
});

test("the notice goes to the old address, the new one escaped", () => {
  assert.deepEqual(
    emailChangedNotice({ from: "ivanov@f1lab.ru", to: "petrov@f1lab.ru" }),
    {
      instrument: "email",
      to: { email: "ivanov@f1lab.ru" },
      title: "Email учётной записи изменён",
      text: "<p>Email вашей учётной записи изменён на petrov@f1lab.ru. Если это сделали не вы — обратитесь к администратору.</p>",
    },
  );
  // Кавычки в локальной части адреса допустимы — и `<` в них тоже
  assert.match(
    emailChangedNotice({ from: "a@f1lab.ru", to: '"<b>"@f1lab.ru' }).text,
    /"&lt;b&gt;"@f1lab\.ru/,
  );
});
