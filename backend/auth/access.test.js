// node --test auth/access.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  GROUPS,
  ALL_ACTIONS,
  audienceOfAction,
  accountAudienceOf,
  stripStatementsForAudience,
  isFullAccess,
  fullAccessStatements,
  isStaffAdmin,
  STAFF_ACTIONS,
  staffAccessStatements,
} = require("./access");

test("dictionary has 16 groups and 56 actions in the agreed order", () => {
  assert.equal(GROUPS.length, 16);
  assert.equal(ALL_ACTIONS.length, 56);
  assert.deepEqual(ALL_ACTIONS.slice(0, 8), [
    "ticket.readCompanies",
    "ticket.readAll",
    "ticket.perform",
    "ticket.join",
    "ticket.manage",
    "ticket.delete",
    "ticket.createForOthers",
    "ticket.closeWithoutWork",
  ]);
  assert.equal(ALL_ACTIONS.at(-1), "settings.manage");
  // «ИИ» — предпоследняя группа: настройки замыкают словарь
  assert.equal(GROUPS.at(-2).key, "ai");
  assert.deepEqual(
    GROUPS.at(-2).actions.map((action) => action.id),
    ["ai.use"],
  );
});

test("every action has an audience; clientHint only on both", () => {
  for (const group of GROUPS) {
    for (const action of group.actions) {
      assert.ok(["staff", "client", "both"].includes(action.audience), action.id);
      if (action.clientHint) assert.equal(action.audience, "both", action.id);
      assert.match(action.label, /^(Видеть|Изменять|Брать|Вести|Удалять|Заводить|Закрывать|Записывать|Согласовывать|Управлять|Входить|Модерировать|Запускать|Присоединяться|Пользоваться) /, action.id);
    }
  }
});

test("audiences of the spec's special cases", () => {
  assert.equal(audienceOfAction("ticket.perform"), "staff");
  assert.equal(audienceOfAction("ticket.readCompanies"), "both");
  assert.equal(audienceOfAction("approval.decide"), "client");
  assert.equal(audienceOfAction("work.readCost"), "both");
  assert.equal(audienceOfAction("settings.manage"), "staff");
  // ИИ — инструмент сотрудника: клиентской роли право не предлагается
  assert.equal(audienceOfAction("ai.use"), "staff");
  assert.equal(audienceOfAction("nope.nothing"), "staff");
});

test("account audience: isEndUser false is staff, anything else is client", () => {
  assert.equal(accountAudienceOf({ isEndUser: false }), "staff");
  assert.equal(accountAudienceOf({ isEndUser: true }), "client");
  assert.equal(accountAudienceOf({}), "client");
});

test("stripping keeps both-actions and drops the other audience", () => {
  const statements = {
    ticket: ["readCompanies", "perform", "createForOthers"],
    approval: ["read", "decide", "manage"],
    settings: ["manage"],
  };
  assert.deepEqual(stripStatementsForAudience(statements, "client"), {
    ticket: ["readCompanies", "createForOthers"],
    approval: ["read", "decide"],
  });
  assert.deepEqual(stripStatementsForAudience(statements, "staff"), {
    ticket: ["readCompanies", "perform", "createForOthers"],
    approval: ["read", "manage"],
    settings: ["manage"],
  });
});

test("the isAdmin mirror is honoured only on staff accounts", () => {
  assert.equal(isStaffAdmin({ isEndUser: false, isAdmin: true }), true);
  // Остаток прежней раздачи на клиентской учётке не действует ни дня: то же
  // правило читают effectivePermissions и buildAuthContext.
  assert.equal(isStaffAdmin({ isEndUser: true, isAdmin: true }), false);
  assert.equal(isStaffAdmin({ isAdmin: true }), false);
  assert.equal(isStaffAdmin({ isEndUser: false }), false);
  assert.equal(isStaffAdmin(null), false);
});

test("full access is measured by the staff dictionary", () => {
  const full = fullAccessStatements();
  assert.equal(isFullAccess(full), true);
  // Вырезание по адресату полноту доступа НЕ ломает: мерка — действия
  // сотрудника, а клиентские в неё не входят.
  assert.equal(isFullAccess(stripStatementsForAudience(full, "staff")), true);
  assert.equal(isFullAccess(staffAccessStatements()), true);
});

test("the staff dictionary is everything but the client-only actions", () => {
  assert.equal(STAFF_ACTIONS.length, ALL_ACTIONS.length - 1);
  assert.equal(STAFF_ACTIONS.includes("approval.decide"), false);
  assert.deepEqual(
    ALL_ACTIONS.filter((id) => !STAFF_ACTIONS.includes(id)),
    ["approval.decide"],
  );
});

test("isFullAccess ignores client-only actions but not staff ones", () => {
  const staff = staffAccessStatements();
  assert.equal(staff.approval.includes("decide"), false);

  // Роль администратора из каталога — ровно этот набор, без approval.decide
  assert.equal(isFullAccess(staff), true);
  // Клиентское действие сверху ничего не меняет
  assert.equal(
    isFullAccess({ ...staff, approval: [...staff.approval, "decide"] }),
    true,
  );
  // А пропущенное действие сотрудника — меняет
  assert.equal(isFullAccess({ ...staff, settings: [] }), false);
  assert.equal(
    isFullAccess({ ...staff, ticket: staff.ticket.slice(1) }),
    false,
  );
});
