// node --test services/permissionHolders.test.js
//
// Последний носитель права сотрудника (services/permissionHolders.js): кто
// считается носителем и какие права правка оставляет без единого носителя.
// Состояние приходит обычными объектами, базы нет; фраза отказа — та, что
// строит services/roles.js.
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");

const {
  STAFF_ACTIONS,
  staffAccessStatements,
  actionsToStatements,
} = require("@/auth/access");
const {
  heldStaffActions,
  fullAccessHolderCount,
  orphanedStaffActions,
  withRoles,
  withoutUser,
  withoutUsers,
  asClient,
  withAccountPatch,
  withRoleStatements,
  withoutRole,
  withoutCompany,
} = require("./permissionHolders");
const { orphanMessage } = require("./roles");

const OUR = "66bb00000000000000000001";
const CLIENT_CO = "66bb00000000000000000002";
const DAY = 24 * 60 * 60 * 1000;

/** Действующий сотрудник: не отключён, не служебный, компания работает. */
const staff = (id, roles, extra = {}) => ({
  id,
  isEndUser: false,
  banned: false,
  banExpires: null,
  isServiceAccount: false,
  companyId: OUR,
  companyActive: true,
  roles,
  ...extra,
});

const ENGINEER = {
  statements: { ticket: ["perform", "join"], work: ["read", "log"] },
  audience: "staff",
};
const LEAD = {
  statements: { ticket: ["perform", "manage"], role: ["manage"] },
  audience: "staff",
};

const stateOf = (accounts, roles = { engineer: ENGINEER, lead: LEAD }) => ({
  accounts,
  catalogue: new Map(Object.entries(roles)),
});

const held = (state) => [...heldStaffActions(state)].sort();

test("an active staff member holds exactly the staff actions of its roles", () => {
  assert.deepEqual(held(stateOf([staff("a", ["engineer"])])), [
    "ticket.join",
    "ticket.perform",
    "work.log",
    "work.read",
  ]);

  // Клиентское действие у сотрудника не действует, действия не из словаря нет,
  // а роль, которой нет в каталоге, не даёт ничего
  const odd = {
    statements: { approval: ["read", "decide"], ticket: ["noSuchAction"] },
    audience: "staff",
  };
  assert.deepEqual(held(stateOf([staff("a", ["odd", "gone"])], { odd })), [
    "approval.read",
  ]);

  // Администратор держит всё через набор роли полного доступа, без особого случая
  const admin = { statements: staffAccessStatements(), audience: "staff" };
  assert.deepEqual(
    held(stateOf([staff("a", ["admin"])], { admin })),
    [...STAFF_ACTIONS].sort(),
  );
});

test("banned, service, client and inactive-company accounts hold nothing", () => {
  for (const [why, extra] of [
    ["banned", { banned: true }],
    ["banned until a future date", { banned: true, banExpires: new Date(Date.now() + DAY) }],
    ["a service account", { isServiceAccount: true }],
    ["a client", { isEndUser: true }],
    ["an account of no recorded type", { isEndUser: undefined }],
    ["an account of an inactive company", { companyActive: false }],
  ]) {
    assert.equal(
      heldStaffActions(stateOf([staff("a", ["lead"], extra)])).size,
      0,
      why,
    );
  }

  // Срок отключения вышел — это уже не отключение (services/authBan.js)
  const expired = staff("a", ["lead"], {
    banned: true,
    banExpires: new Date(Date.now() - DAY),
  });
  assert.ok(heldStaffActions(stateOf([expired])).has("role.manage"));
});

test("staff actions inside a client-audience role do not count", () => {
  const client = {
    statements: { ticket: ["readCompanies", "perform"], work: ["read"] },
    audience: "client",
  };
  assert.deepEqual(held(stateOf([staff("a", ["client"])], { client })), []);
  assert.deepEqual(
    held(stateOf([staff("a", ["client"], { isEndUser: true })], { client })),
    [],
  );

  // Адресат не записан — «сотрудникам», как и везде
  const legacy = { statements: { ticket: ["perform"] } };
  assert.deepEqual(held(stateOf([staff("a", ["legacy"])], { legacy })), [
    "ticket.perform",
  ]);
});

test("full access is counted per active staff account with a full-access staff role", () => {
  const roles = {
    admin: { statements: staffAccessStatements(), audience: "staff" },
    engineer: ENGINEER,
    // Весь словарь сотрудника, но двумя ролями: ни одна не полная — как и у
    // зеркала isAdmin (`mirrorOf`), полный доступ даёт одна роль, а не сумма
    "half-a": {
      statements: actionsToStatements(STAFF_ACTIONS.slice(0, 30)),
      audience: "staff",
    },
    "half-b": {
      statements: actionsToStatements(STAFF_ACTIONS.slice(30)),
      audience: "staff",
    },
    "client-full": { statements: staffAccessStatements(), audience: "client" },
  };

  assert.equal(fullAccessHolderCount(stateOf([staff("a", ["admin"])], roles)), 1);
  assert.equal(
    fullAccessHolderCount(
      stateOf(
        [staff("a", ["admin", "engineer"]), staff("b", ["admin"]), staff("c", ["engineer"])],
        roles,
      ),
    ),
    2,
  );

  for (const [why, account] of [
    ["banned", staff("a", ["admin"], { banned: true })],
    ["banned until a future date", staff("a", ["admin"], { banned: true, banExpires: new Date(Date.now() + DAY) })],
    ["a service account", staff("a", ["admin"], { isServiceAccount: true })],
    ["a client", staff("a", ["admin"], { isEndUser: true })],
    ["an account of an inactive company", staff("a", ["admin"], { companyActive: false })],
    ["a client-audience role", staff("a", ["client-full"])],
    ["every action, but through two roles", staff("a", ["half-a", "half-b"])],
    ["a role missing from the catalogue", staff("a", ["gone"])],
  ]) {
    assert.equal(fullAccessHolderCount(stateOf([account], roles)), 0, why);
  }

  // Срок отключения вышел — это уже не отключение
  assert.equal(
    fullAccessHolderCount(
      stateOf([staff("a", ["admin"], { banned: true, banExpires: new Date(Date.now() - DAY) })], roles),
    ),
    1,
  );
  // До и после: уход единственного носителя оставляет ноль
  const before = stateOf([staff("a", ["admin"]), staff("b", ["half-a", "half-b"])], roles);
  assert.equal(fullAccessHolderCount(withoutUser(before, "a")), 0);
  assert.deepEqual(orphanedStaffActions(before, withoutUser(before, "a")), []);
});

test("removing the only holder's role reports the actions it took away", () => {
  const before = stateOf([staff("a", ["engineer", "lead"]), staff("b", ["engineer"])]);

  assert.deepEqual(
    orphanedStaffActions(before, withRoles(before, "a", ["engineer"])),
    ["role.manage", "ticket.manage"],
  );
  // Носитель уходит сам: отключение или удаление, перевод в клиенты
  assert.deepEqual(orphanedStaffActions(before, withoutUser(before, "a")), [
    "role.manage",
    "ticket.manage",
  ]);
  assert.deepEqual(orphanedStaffActions(before, asClient(before, "a")), [
    "role.manage",
    "ticket.manage",
  ]);
});

test("nothing is reported while another active staff member holds the action", () => {
  const before = stateOf([staff("a", ["lead"]), staff("b", ["lead"])]);
  assert.deepEqual(
    orphanedStaffActions(before, withRoles(before, "a", ["engineer"])),
    [],
  );
  assert.deepEqual(orphanedStaffActions(before, withoutUser(before, "a")), []);

  // Второй, который действовать не может, носителем не считается
  const lonely = stateOf([staff("a", ["lead"]), staff("b", ["lead"], { banned: true })]);
  assert.deepEqual(orphanedStaffActions(lonely, withoutUser(lonely, "a")), [
    "role.manage",
    "ticket.manage",
    "ticket.perform",
  ]);
});

test("a permission nobody holds today is never reported", () => {
  // Права ведущего есть только у отключённого: потерять их уже нельзя, и
  // правка, которая их касается, ничего не блокирует
  const before = stateOf([
    staff("a", ["engineer"]),
    staff("b", ["lead"], { banned: true }),
  ]);
  assert.deepEqual(orphanedStaffActions(before, withoutUser(before, "b")), []);
  assert.deepEqual(orphanedStaffActions(before, withoutRole(before, "lead")), []);
  assert.deepEqual(
    orphanedStaffActions(before, withRoleStatements(before, "lead", {}, "staff")),
    [],
  );
  // У единственного носителя снимают роль инженера — в отказе только её права
  assert.deepEqual(orphanedStaffActions(before, withRoles(before, "a", [])), [
    "ticket.join",
    "ticket.perform",
    "work.log",
    "work.read",
  ]);
});

test("cutting a role down or handing it to clients reports what only it gave", () => {
  const before = stateOf([staff("a", ["engineer", "lead"])]);

  // «Брать заявки в работу» даёт и роль инженера — его потери нет
  assert.deepEqual(
    orphanedStaffActions(
      before,
      withRoleStatements(before, "lead", { ticket: ["perform"] }, "staff"),
    ),
    ["role.manage", "ticket.manage"],
  );
  // Набор тот же, но роль теперь клиентская: сотруднику она прав не даёт
  assert.deepEqual(
    orphanedStaffActions(
      before,
      withRoleStatements(before, "lead", LEAD.statements, "client"),
    ),
    ["role.manage", "ticket.manage"],
  );
});

test("every transformer returns a new state and leaves its input untouched", () => {
  const state = stateOf([
    staff("a", ["engineer", "lead"]),
    staff("b", ["lead"], {
      companyId: CLIENT_CO,
      banExpires: new Date("2030-01-01T00:00:00Z"),
    }),
  ]);
  const snapshot = structuredClone(state);

  for (const [name, change] of [
    ["withRoles", (s) => withRoles(s, "a", ["engineer"])],
    ["withoutUser", (s) => withoutUser(s, "a")],
    ["withoutUsers", (s) => withoutUsers(s, ["a", "b"])],
    ["asClient", (s) => asClient(s, "a")],
    ["withAccountPatch", (s) => withAccountPatch(s, "b", { banned: true, banExpires: null })],
    ["withRoleStatements", (s) => withRoleStatements(s, "lead", { ticket: ["perform"] }, "client")],
    ["withoutRole", (s) => withoutRole(s, "lead")],
    ["withoutCompany", (s) => withoutCompany(s, OUR)],
  ]) {
    const next = change(state);
    assert.notEqual(next, state, name);
    assert.notEqual(next.accounts, state.accounts, name);
    assert.notEqual(next.catalogue, state.catalogue, name);
    assert.deepEqual(state, snapshot, name);
  }
});

test("each transformer changes exactly what it names", () => {
  const state = stateOf([staff("a", ["engineer"]), staff("b", ["lead"])]);

  assert.deepEqual(
    withRoles(state, "a", ["lead"]).accounts.map((account) => account.roles),
    [["lead"], ["lead"]],
  );
  assert.deepEqual(
    withoutUser(state, "a").accounts.map((account) => account.id),
    ["b"],
  );
  assert.deepEqual(
    asClient(state, "a").accounts.map((account) => account.isEndUser),
    [true, false],
  );
  const changed = withRoleStatements(state, "lead", { ticket: ["perform"] }, "client");
  assert.deepEqual(changed.catalogue.get("lead"), {
    statements: { ticket: ["perform"] },
    audience: "client",
  });
  assert.deepEqual(changed.catalogue.get("engineer"), ENGINEER);
});

test("withoutRole also strips the key from every account", () => {
  const state = stateOf([
    staff("a", ["engineer", "lead"]),
    staff("b", ["lead"]),
    staff("c", ["engineer"]),
  ]);
  const next = withoutRole(state, "lead");

  assert.equal(next.catalogue.has("lead"), false);
  assert.ok(next.catalogue.has("engineer"));
  assert.deepEqual(
    next.accounts.map((account) => account.roles),
    [["engineer"], [], ["engineer"]],
  );
});

test("withoutCompany only affects accounts of that company", () => {
  const state = stateOf([
    staff("a", ["lead"]),
    staff("b", ["engineer"], { companyId: CLIENT_CO }),
    staff("c", ["engineer"], { companyId: null }),
  ]);

  const client = withoutCompany(state, CLIENT_CO);
  assert.deepEqual(
    client.accounts.map((account) => account.companyActive),
    [true, false, true],
  );
  // Права инженера остаются у человека без компании — потери нет
  assert.deepEqual(orphanedStaffActions(state, client), []);

  // Своя компания: права ведущего уходят вместе с её человеком
  const ours = withoutCompany(state, OUR);
  assert.deepEqual(
    ours.accounts.map((account) => account.companyActive),
    [false, true, true],
  );
  assert.deepEqual(orphanedStaffActions(state, ours), [
    "role.manage",
    "ticket.manage",
  ]);
});

test("withAccountPatch replaces only the holder fields it carries, on one account", () => {
  const state = stateOf([staff("a", ["lead"]), staff("b", ["lead"])]);
  const next = withAccountPatch(state, "a", {
    isServiceAccount: true,
    companyId: CLIENT_CO,
    companyActive: false,
    // Не признаки носителя: роли меняет withRoles, id не меняется вовсе
    roles: ["engineer"],
    id: "z",
  });

  assert.deepEqual(next.accounts, [
    {
      ...staff("a", ["lead"]),
      isServiceAccount: true,
      companyId: CLIENT_CO,
      companyActive: false,
    },
    staff("b", ["lead"]),
  ]);
  // Пустой патч — та же учётная запись
  assert.deepEqual(withAccountPatch(state, "a", {}).accounts, state.accounts);
});

test("a patch that takes the only holder out reports its actions, a harmless one does not", () => {
  const before = stateOf([staff("a", ["lead"]), staff("b", ["engineer"])]);
  const lost = ["role.manage", "ticket.manage"];

  for (const [why, patch] of [
    ["a ban", { banned: true }],
    ["a ban until a future date", { banned: true, banExpires: new Date(Date.now() + DAY) }],
    ["a flip to client", { isEndUser: true }],
    ["a service account", { isServiceAccount: true }],
    ["a move to an inactive company", { companyId: CLIENT_CO, companyActive: false }],
  ]) {
    assert.deepEqual(
      orphanedStaffActions(before, withAccountPatch(before, "a", patch)),
      lost,
      why,
    );
  }

  // Срок отключения уже вышел — это не отключение; другая работающая
  // компания — не потеря
  assert.deepEqual(
    orphanedStaffActions(
      before,
      withAccountPatch(before, "a", { banned: true, banExpires: new Date(Date.now() - DAY) }),
    ),
    [],
  );
  assert.deepEqual(
    orphanedStaffActions(
      before,
      withAccountPatch(before, "a", { companyId: CLIENT_CO, companyActive: true }),
    ),
    [],
  );
});

test("withoutUsers drops every listed account and keeps the rest", () => {
  const listed = "66aa00000000000000000007";
  const state = stateOf([
    staff("a", ["lead"]),
    staff("b", ["engineer"]),
    staff(listed, ["engineer"]),
  ]);

  // Идентификатор может прийти и ObjectId — сравнение строками; неизвестный
  // и повторённый ничего не ломают
  const next = withoutUsers(state, ["a", new Types.ObjectId(listed), "a", "nobody"]);
  assert.deepEqual(
    next.accounts.map((account) => account.id),
    ["b"],
  );
  assert.deepEqual(orphanedStaffActions(state, next), [
    "role.manage",
    "ticket.manage",
  ]);
  assert.deepEqual(withoutUsers(state, []).accounts, state.accounts);
});

test("the refusal names the permissions in dictionary order, one or several", () => {
  assert.equal(
    orphanMessage(["role.manage"]),
    "После этого ни у кого не останется права «Изменять роли». Сначала выдайте его другому сотруднику.",
  );
  // Порядок словаря (auth/access.js), а не алфавит идентификаторов:
  // «Пользователи» в словаре раньше «Ролей»
  assert.equal(
    orphanMessage(["role.manage", "user.manage"]),
    "После этого ни у кого не останутся права «Изменять пользователей», «Изменять роли». Сначала выдайте их другим сотрудникам.",
  );
});

test("the refusal names at most five permissions and counts the rest", () => {
  const five = [
    "settings.manage",
    "role.manage",
    "user.manage",
    "ticket.delete",
    "work.manage",
  ];
  assert.equal(
    orphanMessage(five),
    "После этого ни у кого не останутся права «Удалять заявки», «Изменять все работы», «Изменять пользователей», «Изменять роли», «Изменять настройки». Сначала выдайте их другим сотрудникам.",
  );

  // Больше пяти — первые пять по словарю, остальные числом
  assert.equal(
    orphanMessage([...five, "ai.use", "mikrotik.upgradeFirmware"]),
    "После этого ни у кого не останутся права «Удалять заявки», «Изменять все работы», «Изменять пользователей», «Изменять роли», «Обновлять прошивку Mikrotik» и ещё 2. Сначала выдайте их другим сотрудникам.",
  );
  assert.equal(
    orphanMessage([...STAFF_ACTIONS].reverse()),
    `После этого ни у кого не останутся права «Видеть заявки своих компаний», «Видеть все заявки», «Брать заявки в работу», «Присоединяться к чужим заявкам», «Вести заявки» и ещё ${STAFF_ACTIONS.length - 5}. Сначала выдайте их другим сотрудникам.`,
  );
});
