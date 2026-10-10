// node --test services/roles.test.js
//
// Пороги правки каталога ролей — их чистые части. Сами `update`, `remove` и
// `assign` без базы не проверить (роли и членство лежат в коллекциях плагина),
// поэтому проверяется то, что решает: какое несущее право роль теряет
// (`lastKeeperLoss` — список остальных ролей приходит параметром) и подходит ли
// роль учётной записи по адресату (`assertRoleFitsAccount`).
//
// Исключение — проверка последнего носителя права: она сама и есть чтение
// базы. Её место в `assign`, `update` и `remove` проверяется в конце файла на
// базе в памяти (`memoryDb`).
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const mongoose = require("mongoose");
const sift = require("sift").default;

const {
  STAFF_ACTIONS,
  staffAccessStatements,
  actionsToStatements,
  isFullAccess,
} = require("@/auth/access");
const { CATALOGUE } = require("@/scripts/syncRoleCatalogue");
const {
  lastKeeperLoss,
  losesLastFullAccess,
  staffSideOf,
  assertRoleFitsAccount,
  lockedActionChanges,
  losesLastFullAccessHolder,
  pluginRole,
  mirrorOf,
  needsUpgradeFirmwareGrant,
  needsApproveChangesGrant,
  rolesToRefresh,
  orphanMessage,
  loadHolderState,
  assertNoOrphanedStaffActions,
  assertNotLastFullAccessHolder,
} = require("./roles");
const rolesService = require("./roles");
const { withoutUser } = require("./permissionHolders");

const ROLE_MANAGE = { role: ["manage"], user: ["manage"] };

test("a role keeping role.manage to itself may not drop it", () => {
  // Ровно та дыра, из-за которой порог и появился: PATCH /roles/admin с пустым
  // набором гасил зеркало isAdmin у всех, и вернуть его было некому.
  assert.equal(lastKeeperLoss(ROLE_MANAGE, {}, []), "role.manage");
  assert.equal(
    lastKeeperLoss(ROLE_MANAGE, { role: ["read"] }, [{ ticket: ["manage"] }]),
    "role.manage",
  );
});

test("dropping it is fine while another role holds it", () => {
  assert.equal(lastKeeperLoss(ROLE_MANAGE, {}, [ROLE_MANAGE]), null);
  // Вторая роль держит только role.manage — user.manage всё равно теряется
  assert.equal(
    lastKeeperLoss(ROLE_MANAGE, {}, [{ role: ["manage"] }]),
    "user.manage",
  );
});

test("keeping the action is not losing it", () => {
  assert.equal(lastKeeperLoss(ROLE_MANAGE, ROLE_MANAGE, []), null);
  // Роль, которая этих прав и не давала, порогом не связана
  assert.equal(lastKeeperLoss({ ticket: ["manage"] }, {}, []), null);
});

test("the last full-access role may not be cut down", () => {
  const full = staffAccessStatements();

  // Порог «хранителей» это НЕ ловит: `role.manage` и `user.manage` остаются при
  // роли, а зеркало isAdmin гаснет у всех — и вернуть остальное уже нечем.
  const keepers = { role: ["manage"], user: ["manage"] };
  assert.equal(lastKeeperLoss(full, keepers, []), null);
  assert.equal(losesLastFullAccess(full, keepers, []), true);
  assert.equal(losesLastFullAccess(full, {}, []), true);

  // Пока полный доступ отдаёт другая роль — можно
  assert.equal(losesLastFullAccess(full, keepers, [full]), false);
  // Роль, полного доступа и не отдававшая, порогом не связана
  assert.equal(losesLastFullAccess(keepers, {}, []), false);
  // Правка, при которой полный доступ остаётся, — тоже
  assert.equal(losesLastFullAccess(full, full, []), false);
  // Клиентское действие сверху полноту не меняет (мерка — набор сотрудника)
  assert.equal(
    losesLastFullAccess(
      { ...full, approval: [...full.approval, "decide"] },
      full,
      [],
    ),
    false,
  );
});

test("a staff role is refused to a client account and back", () => {
  const staffRole = { key: "admin", title: "Администратор", audience: "staff" };
  const clientRole = { key: "client", title: "Клиент", audience: "client" };

  // Клиентская учётная запись с ролью полного доступа получала через зеркало
  // isAdmin заявки всех компаний — адресат роли был только подсказкой форме.
  assert.throws(() => assertRoleFitsAccount(staffRole, { isEndUser: true }), {
    statusCode: 409,
    message: /Администратор/,
  });
  assert.throws(() => assertRoleFitsAccount(staffRole, {}), { statusCode: 409 });
  assert.throws(
    () => assertRoleFitsAccount(clientRole, { isEndUser: false }),
    { statusCode: 409, message: /Клиент/ },
  );

  assert.doesNotThrow(() =>
    assertRoleFitsAccount(staffRole, { isEndUser: false }),
  );
  assert.doesNotThrow(() =>
    assertRoleFitsAccount(clientRole, { isEndUser: true }),
  );

  // Служебная учётная запись заводится только формой человека, а та ставит ей
  // `isEndUser: false` (`kindToFlags`), то есть по адресату это сотрудник.
  // Отдельного правила ей не нужно и по второй причине: роли служебной учётке
  // не положены вовсе (controllers/role.js), набор у неё пустой, и до проверки
  // адресата дело не доходит.
  assert.doesNotThrow(() =>
    assertRoleFitsAccount(staffRole, { isEndUser: false, isServiceAccount: true }),
  );
});

test("flipping the audience counts as losing full access", () => {
  const full = staffAccessStatements();

  // Правка одного адресата не трогает набор — и порог её не замечал: PATCH
  // {audience: "client"} переводил роль администратора в клиентские, а
  // носители-сотрудники оставались без полного доступа.
  assert.equal(losesLastFullAccess(full, full, []), false);
  assert.equal(
    losesLastFullAccess(
      staffSideOf(full, "staff"),
      staffSideOf(full, "client"),
      [],
    ),
    true,
  );
  // Обратный ход (клиентская роль становится сотрудничьей) ничего не теряет
  assert.equal(
    losesLastFullAccess(
      staffSideOf(full, "client"),
      staffSideOf(full, "staff"),
      [],
    ),
    false,
  );
  // Несущие права теряются так же
  assert.equal(
    lastKeeperLoss(
      staffSideOf(ROLE_MANAGE, "staff"),
      staffSideOf(ROLE_MANAGE, "client"),
      [],
    ),
    "role.manage",
  );
  // Клиентская роль хранителем не считается — её действия сотруднику не дают
  assert.equal(
    lastKeeperLoss(ROLE_MANAGE, {}, [staffSideOf(ROLE_MANAGE, "client")]),
    "role.manage",
  );
});

// Правящий держит весь словарь, кроме перечисленного, — ровно случай владельца:
// роль со всеми правами без «Закрывать без записи о работе».
const canAllBut =
  (...missing) =>
  (request) =>
    Object.entries(request).every(([resource, actions]) =>
      actions.every((action) => !missing.includes(`${resource}.${action}`)),
    );

test("a role with actions the editor lacks stays editable around them", () => {
  const can = canAllBut("ticket.closeWithoutWork");
  const before = { ticket: ["readAll", "closeWithoutWork"], work: ["read"] };

  // Запертое право на месте, вокруг него правка свободна: своё право снято
  // (ticket.readAll), своё добавлено (work.manage). Прежний порог отбивал и
  // это — и даже смену одного названия.
  assert.deepEqual(
    lockedActionChanges(
      before,
      { ticket: ["closeWithoutWork"], work: ["read", "manage"] },
      can,
    ),
    { added: [], removed: [] },
  );
  // Набор не тронут вовсе
  assert.deepEqual(lockedActionChanges(before, before, can), {
    added: [],
    removed: [],
  });
});

test("a locked action can be neither granted nor taken away", () => {
  const can = canAllBut("ticket.closeWithoutWork");

  // Выдать то, чего нет у самого, — эскалация: завёл право в роль, роль себе
  assert.deepEqual(
    lockedActionChanges(
      { work: ["read"] },
      { work: ["read"], ticket: ["closeWithoutWork"] },
      can,
    ),
    { added: ["ticket.closeWithoutWork"], removed: [] },
  );
  // Снять — распоряжение чужим правом: вернуть его правящему уже нечем
  assert.deepEqual(
    lockedActionChanges(
      { work: ["read"], ticket: ["closeWithoutWork"] },
      { work: ["read"] },
      can,
    ),
    { added: [], removed: ["ticket.closeWithoutWork"] },
  );
});

test("an action gone from the dictionary does not lock the role", () => {
  // Роль из старого словаря: действия больше нет, `can` на него отвечает
  // отказом — без просеивания оно считалось бы запертым и снятым, и роль не
  // сохранялась бы никогда.
  assert.deepEqual(
    lockedActionChanges(
      { work: ["read"], ticket: ["noSuchAction"] },
      { work: ["read"] },
      canAllBut("ticket.noSuchAction"),
    ),
    { added: [], removed: [] },
  );
});

test("the last holder of full access may not be stripped of it", () => {
  const full = new Set(["admin"]);

  // Ровно так владелец и запер себя: сменил себе «admin» на роль без одного
  // права, второй администратор — следом, и вернуть полный доступ стало некому
  // (выдать роль администратора может только тот, у кого есть все её права).
  assert.equal(
    losesLastFullAccessHolder(["admin"], ["almost-admin"], full, 0),
    true,
  );
  assert.equal(losesLastFullAccessHolder(["admin", "kb"], [], full, 0), true);

  // Пока полный доступ есть у кого-то ещё — можно
  assert.equal(
    losesLastFullAccessHolder(["admin"], ["almost-admin"], full, 1),
    false,
  );
  // Роль полного доступа остаётся при человеке (добавили вторую, сняли лишнюю)
  assert.equal(
    losesLastFullAccessHolder(["admin", "kb"], ["admin"], full, 0),
    false,
  );
  // Полного доступа у него и не было
  assert.equal(losesLastFullAccessHolder(["kb"], [], full, 0), false);
  // Пересел с одной роли полного доступа на другую
  assert.equal(
    losesLastFullAccessHolder(["admin"], ["owner"], new Set(["admin", "owner"]), 0),
    false,
  );
});

test("the plugin role follows the account audience: a client is never an impersonator", () => {
  const impersonate = { user: ["read", "impersonate"] };

  assert.equal(pluginRole(impersonate, "staff"), "impersonator");
  // «Входить под пользователем» у клиента не действует — и роль плагина тоже
  assert.equal(pluginRole(impersonate, "client"), "user");
  assert.equal(pluginRole({ user: ["read"] }, "staff"), "user");
  // Адресат не передан — закрыто: остаются только действия `both`
  assert.equal(pluginRole(impersonate, undefined), "user");
  assert.equal(pluginRole(null, "staff"), "user");
});

test("the mirror gives admin and impersonator to staff only", () => {
  const catalogue = new Map([
    ["admin", staffAccessStatements()],
    ["support", { ticket: ["perform"], user: ["impersonate"] }],
    ["client", { ticket: ["readCompanies"] }],
  ]);
  const staff = { isEndUser: false };
  const client = { isEndUser: true };

  assert.deepEqual(mirrorOf(["admin"], catalogue, staff), {
    isAdmin: true,
    role: "impersonator",
  });
  // Роль полного доступа на клиентской учётной записи не даёт ни того ни другого
  assert.deepEqual(mirrorOf(["admin"], catalogue, client), {
    isAdmin: false,
    role: "user",
  });
  assert.deepEqual(mirrorOf(["support"], catalogue, staff), {
    isAdmin: false,
    role: "impersonator",
  });
  assert.deepEqual(mirrorOf(["support", "client"], catalogue, client), {
    isAdmin: false,
    role: "user",
  });
  // Тип не записан — это клиент, как и везде (accountAudienceOf)
  assert.deepEqual(mirrorOf(["support"], catalogue, {}), {
    isAdmin: false,
    role: "user",
  });
  // Роли нет в каталоге (удалена) или ролей нет вовсе — ничего не даёт
  assert.deepEqual(mirrorOf(["gone"], catalogue, staff), {
    isAdmin: false,
    role: "user",
  });
  assert.deepEqual(mirrorOf([], catalogue, staff), {
    isAdmin: false,
    role: "user",
  });
});

test("only a role one action short of full access needs the firmware grant", () => {
  const full = staffAccessStatements();
  // Администратор до раздачи: весь словарь сотрудника, кроме одного действия
  const short = {
    ...full,
    mikrotik: full.mikrotik.filter((action) => action !== "upgradeFirmware"),
  };

  assert.equal(isFullAccess(short), false);
  assert.equal(needsUpgradeFirmwareGrant(short), true);

  // Право уже есть — раздавать нечего: повторный прогон ничего не меняет
  assert.equal(needsUpgradeFirmwareGrant(full), false);
  // Не хватает и чего-то ещё — одно это право роль полной не сделает, и мы его
  // не даём: раздача не должна превращать в администратора то, что им не было
  assert.equal(
    needsUpgradeFirmwareGrant({
      ...short,
      ticket: short.ticket.filter((action) => action !== "delete"),
    }),
    false,
  );
  // Обычная роль сотрудника и набор клиентской роли: до полного доступа далеко
  assert.equal(
    needsUpgradeFirmwareGrant({ ticket: ["perform"], mikrotik: ["read"] }),
    false,
  );
  assert.equal(
    needsUpgradeFirmwareGrant({
      ticket: ["readCompanies", "createForOthers"],
      work: ["read"],
      approval: ["read", "decide"],
    }),
    false,
  );
  // Пустое и отсутствующее
  assert.equal(needsUpgradeFirmwareGrant({}), false);
  assert.equal(needsUpgradeFirmwareGrant(undefined), false);
});

test("only a role one action short of full access needs the approveChanges grant", () => {
  const full = staffAccessStatements();
  assert.ok(full.mikrotik.includes("approveChanges"));
  const short = {
    ...full,
    mikrotik: full.mikrotik.filter((action) => action !== "approveChanges"),
  };
  assert.equal(isFullAccess(short), false);
  assert.equal(needsApproveChangesGrant(short), true);
  assert.equal(needsApproveChangesGrant(full), false);
  // не хватает ещё чего-то — не раздаём
  assert.equal(
    needsApproveChangesGrant({
      ...short,
      ticket: short.ticket.filter((action) => action !== "delete"),
    }),
    false,
  );
  assert.equal(needsApproveChangesGrant({ ticket: ["perform"], mikrotik: ["read"] }), false);
  assert.equal(needsApproveChangesGrant({}), false);
  assert.equal(needsApproveChangesGrant(undefined), false);
  // не хватает и upgradeFirmware — раздача от этого не зависит (см. LATE_STAFF_GRANTS)
  assert.equal(
    needsApproveChangesGrant({
      ...short,
      mikrotik: short.mikrotik.filter((action) => action !== "upgradeFirmware"),
    }),
    true,
  );
});

test("late grants are order-independent: a role lacking both late actions gets each in either order", () => {
  const full = staffAccessStatements();
  const without = (statements, ...actions) => ({
    ...statements,
    mikrotik: statements.mikrotik.filter((action) => !actions.includes(action)),
  });
  const add = (statements, action) => ({
    ...statements,
    mikrotik: [...statements.mikrotik, action],
  });

  const both = without(full, "upgradeFirmware", "approveChanges");
  assert.equal(isFullAccess(both), false);
  assert.equal(needsUpgradeFirmwareGrant(both), true);
  assert.equal(needsApproveChangesGrant(both), true);

  // Только одного не хватает
  const onlyFirmware = without(full, "upgradeFirmware");
  assert.equal(needsUpgradeFirmwareGrant(onlyFirmware), true);
  assert.equal(needsApproveChangesGrant(onlyFirmware), false);
  const onlyApprove = without(full, "approveChanges");
  assert.equal(needsUpgradeFirmwareGrant(onlyApprove), false);
  assert.equal(needsApproveChangesGrant(onlyApprove), true);

  // Не хватает ещё чего-то вне списка — не раздаём ни то, ни другое
  const plusOther = {
    ...both,
    ticket: both.ticket.filter((action) => action !== "delete"),
  };
  assert.equal(needsUpgradeFirmwareGrant(plusOther), false);
  assert.equal(needsApproveChangesGrant(plusOther), false);

  // Полная роль — раздавать нечего
  assert.equal(needsUpgradeFirmwareGrant(full), false);
  assert.equal(needsApproveChangesGrant(full), false);

  // Раздали одно — второе по-прежнему нужно; после обоих роль полная
  const afterFirmware = add(both, "upgradeFirmware");
  assert.equal(needsApproveChangesGrant(afterFirmware), true);
  assert.equal(isFullAccess(add(afterFirmware, "approveChanges")), true);
  const afterApprove = add(both, "approveChanges");
  assert.equal(needsUpgradeFirmwareGrant(afterApprove), true);
  assert.equal(isFullAccess(add(afterApprove, "upgradeFirmware")), true);
});

test("rolesToRefresh covers roles needing either late grant", () => {
  const full = staffAccessStatements();
  const both = {
    ...full,
    mikrotik: full.mikrotik.filter(
      (action) => action !== "upgradeFirmware" && action !== "approveChanges",
    ),
  };
  assert.deepEqual(
    rolesToRefresh([{ key: "admin", audience: "staff", statements: both }]),
    ["admin"],
  );
});

test("after the firmware grant every full-access staff role is refreshed, not only the changed ones", () => {
  const full = staffAccessStatements();
  // Администратор до раздачи: весь словарь сотрудника, кроме одного действия
  const short = {
    ...full,
    mikrotik: full.mikrotik.filter((action) => action !== "upgradeFirmware"),
  };
  const shorter = {
    ...short,
    ticket: short.ticket.filter((action) => action !== "delete"),
  };

  assert.deepEqual(
    rolesToRefresh([
      // Будет дополнена этим прогоном — после раздачи она полная
      { key: "admin", audience: "staff", statements: short },
      // Уже дополнена: прошлый прогон оборвался между записью роли и пересчётом
      // зеркала. Повторный ничего не раздаёт, но зеркало пересчитывает — и
      // возвращает `isAdmin` носителям
      { key: "restored", audience: "staff", statements: full },
      // Адресат не записан — «сотрудникам», как везде
      { key: "legacy", statements: full },
      // Не хватает ещё чего-то, и обычная роль сотрудника: полного доступа нет
      { key: "almost", audience: "staff", statements: shorter },
      { key: "engineer", audience: "staff", statements: { ticket: ["perform"] } },
      // Клиентской роли зеркало `isAdmin` не положено, какой бы набор в ней ни лежал
      { key: "client-full", audience: "client", statements: full },
      { key: "client-short", audience: "client", statements: short },
    ]),
    ["admin", "restored", "legacy"],
  );
  assert.deepEqual(rolesToRefresh([]), []);
});

test("the shipped catalogue has a staff role of full access", () => {
  // Первый запуск назначает администратору роль по `roles.find(isFullAccess)`
  // (services/bootstrapSeed.js), а syncRoleCatalogue.js без такой роли
  // отказывается работать. Действие сотрудника, добавленное в словарь без
  // строки в каталоге (c762cfe: mikrotik.upgradeFirmware), оставляло установку
  // без неё — и зеркало `isAdmin` у первого администратора не держалось.
  const { roles } = JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));
  const full = roles.filter(
    (role) =>
      role.audience === "staff" &&
      isFullAccess(actionsToStatements(role.actions || [])),
  );

  assert.ok(
    full.length >= 1,
    "в каталоге нет роли сотрудника с полным доступом: новое действие словаря не добавлено в роль администратора",
  );
});

/**
 * ПОСЛЕДНИЙ НОСИТЕЛЬ ПРАВА — на базе в памяти.
 *
 * Ровно те вызовы коллекций, что делают назначение и правка ролей:
 * find(…).toArray() (с sort), findOne, countDocuments, updateOne (с upsert),
 * deleteOne. Фильтры сопоставляет sift — правила Mongo; проекции не
 * применяются, но запоминаются в `reads`. Каждая запись попадает в `writes`:
 * отказ обязан случиться раньше первой.
 */
const memoryDb = (data) => {
  const writes = [];
  const reads = [];
  const cursor = (rows) => ({
    sort: () => cursor(rows),
    toArray: async () => rows,
  });
  const collection = (name) => {
    const rows = (data[name] ||= []);
    return {
      find: (filter = {}, options = {}) => {
        reads.push([name, filter, options]);
        return cursor(rows.filter(sift(filter)));
      },
      findOne: async (filter = {}) => rows.find(sift(filter)) ?? null,
      countDocuments: async (filter = {}) => rows.filter(sift(filter)).length,
      updateOne: async (filter, update, options = {}) => {
        writes.push([name, "updateOne", filter]);
        let row = rows.find(sift(filter));
        if (!row && options.upsert) {
          row = { ...filter, ...update.$setOnInsert };
          rows.push(row);
        }
        if (row) Object.assign(row, update.$set);
        return { matchedCount: row ? 1 : 0 };
      },
      deleteOne: async (filter) => {
        writes.push([name, "deleteOne", filter]);
        const index = rows.findIndex(sift(filter));
        if (index >= 0) rows.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
    };
  };
  return { db: { collection }, data, writes, reads };
};

let restoreDb = null;
afterEach(() => {
  restoreDb?.();
  restoreDb = null;
});

const ORG = "org-1";
const OUR_COMPANY = new mongoose.Types.ObjectId("66bb00000000000000000001");
const userIdOf = (n) =>
  new mongoose.Types.ObjectId(`66aa0000000000000000000${n}`);
const canAll = () => true;

const roleRow = (key, actions, audience = "staff") => ({
  _id: `role-${key}`,
  organizationId: ORG,
  role: key,
  title: key,
  audience,
  permission: JSON.stringify(actionsToStatements(actions)),
});

/** Действующий сотрудник `n` с ролями строкой — как в `member.role`. */
const person = (n, roles, user = {}) => ({
  user: {
    _id: userIdOf(n),
    isEndUser: false,
    banned: false,
    isServiceAccount: false,
    company: { _id: OUR_COMPANY, isActive: true },
    ...user,
  },
  member: {
    _id: `member-${n}`,
    organizationId: ORG,
    userId: String(userIdOf(n)),
    role: roles,
  },
});

const KB_ACTIONS = ["knowledge.manage", "knowledge.moderate"];

/**
 * Хранитель (role.manage + user.manage) — у первого, база знаний — только у
 * второго, роль инженера — у второго и третьего. Четвёртый — клиент.
 */
const BASE = {
  roles: [
    roleRow("keeper", ["role.read", "role.manage", "user.read", "user.manage"]),
    roleRow("engineer", ["ticket.perform", "work.read", "work.log"]),
    roleRow("kb", KB_ACTIONS),
    roleRow("client", ["ticket.readCompanies"], "client"),
  ],
  people: [
    person(1, "keeper"),
    person(2, "engineer,kb"),
    person(3, "engineer"),
    person(4, "client", { isEndUser: true }),
  ],
};

const install = ({ roles, people }) => {
  const fake = memoryDb({
    organization: [{ _id: ORG, slug: "hd" }],
    organizationRole: structuredClone(roles),
    member: people.map(({ member }) => ({ ...member })),
    users: people.map(({ user }) => ({ ...user })),
  });
  // Настоящее значение запоминается один раз за тест, даже если база в памяти
  // ставится в нём дважды
  if (!restoreDb) {
    const original = mongoose.connection.db;
    restoreDb = () => {
      mongoose.connection.db = original;
    };
  }
  mongoose.connection.db = fake.db;
  return fake;
};

/** Загружалось ли состояние носителей: только оно читает пользователей списком. */
const holdersLoaded = (reads) => reads.some(([name]) => name === "users");

test("loadHolderState reads member roles as a comma list and joins the accounts", async () => {
  const banUntil = new Date("2030-01-01T00:00:00Z");
  const { reads, data } = install({
    roles: [
      roleRow("engineer", ["ticket.perform"]),
      { ...roleRow("legacy", ["work.read"]), audience: undefined },
      roleRow("client", ["ticket.readCompanies"], "client"),
      { ...roleRow("broken", []), permission: "{не json" },
    ],
    people: [
      person(1, " engineer , legacy,engineer"),
      person(2, "engineer", { banned: true, banExpires: banUntil }),
      person(3, "client", { isEndUser: true, company: { _id: OUR_COMPANY, isActive: false } }),
      person(4, "engineer", { isServiceAccount: true, company: undefined }),
    ],
  });
  // Строки членства без документа пользователя и без userId — не носители
  data.member.push(
    { _id: "member-ghost", organizationId: ORG, userId: String(userIdOf(9)), role: "engineer" },
    { _id: "member-empty", organizationId: ORG, role: "engineer" },
  );

  const state = await loadHolderState(ORG);

  assert.deepEqual(state.catalogue.get("legacy"), {
    statements: { work: ["read"] },
    audience: "staff",
  });
  assert.equal(state.catalogue.get("client").audience, "client");
  assert.deepEqual(state.catalogue.get("broken"), { statements: {}, audience: "staff" });

  assert.deepEqual(
    state.accounts.sort((a, b) => a.id.localeCompare(b.id)),
    [
      {
        id: String(userIdOf(1)),
        isEndUser: false,
        banned: false,
        banExpires: undefined,
        isServiceAccount: false,
        companyId: String(OUR_COMPANY),
        companyActive: true,
        roles: ["engineer", "legacy"],
      },
      {
        id: String(userIdOf(2)),
        isEndUser: false,
        banned: true,
        banExpires: banUntil,
        isServiceAccount: false,
        companyId: String(OUR_COMPANY),
        companyActive: true,
        roles: ["engineer"],
      },
      {
        id: String(userIdOf(3)),
        isEndUser: true,
        banned: false,
        banExpires: undefined,
        isServiceAccount: false,
        companyId: String(OUR_COMPANY),
        companyActive: false,
        roles: ["client"],
      },
      {
        id: String(userIdOf(4)),
        isEndUser: false,
        banned: false,
        banExpires: undefined,
        isServiceAccount: true,
        companyId: null,
        companyActive: true,
        roles: ["engineer"],
      },
    ],
  );

  // Пользователи читаются ровно с полями, по которым решается «носитель ли»
  const [, , options] = reads.find(([name]) => name === "users");
  assert.deepEqual(options.projection, {
    isEndUser: 1,
    banned: 1,
    banExpires: 1,
    isServiceAccount: 1,
    "company._id": 1,
    "company.isActive": 1,
  });
});

test("assertNoOrphanedStaffActions refuses with a 409 naming what nobody would keep", async () => {
  install(BASE);

  await assert.rejects(
    assertNoOrphanedStaffActions(ORG, (state) =>
      withoutUser(state, String(userIdOf(2))),
    ),
    { statusCode: 409, message: orphanMessage(KB_ACTIONS) },
  );
  // Роль инженера есть и у второго: уход третьего ничего не отнимает
  await assertNoOrphanedStaffActions(ORG, (state) =>
    withoutUser(state, String(userIdOf(3))),
  );
});

const FULL_ACCESS_MESSAGE =
  "Это последний человек с полным доступом — снять его нельзя: вернуть полный доступ будет некому. Сначала выдайте роль администратора кому-то ещё";

/**
 * Каждое право сотрудника есть и у второго — двумя неполными ролями, так что
 * поштучно ничего не теряется. Но роль администратора, кроме первого, не
 * носит никто, и после его ухода выдать её некому (2026-09-21).
 */
const COVERED = [
  { ...roleRow("admin", []), permission: JSON.stringify(staffAccessStatements()) },
  roleRow("half-a", STAFF_ACTIONS.slice(0, 30)),
  roleRow("half-b", STAFF_ACTIONS.slice(30)),
];

test("assertNoOrphanedStaffActions: the last full-access holder may not leave even with every action covered", async () => {
  install({ roles: COVERED, people: [person(1, "admin"), person(2, "half-a,half-b")] });
  await assert.rejects(
    assertNoOrphanedStaffActions(ORG, (state) =>
      withoutUser(state, String(userIdOf(1))),
    ),
    { statusCode: 409, message: FULL_ACCESS_MESSAGE },
  );

  // Второй действующий носитель полного доступа — можно
  install({
    roles: COVERED,
    people: [person(1, "admin"), person(2, "half-a,half-b"), person(3, "admin")],
  });
  await assertNoOrphanedStaffActions(ORG, (state) =>
    withoutUser(state, String(userIdOf(1))),
  );
});

test("remove: the only held full-access role goes nowhere while another full-access role has no holder", async () => {
  // Порог каталога пропускает — роль полного доступа в каталоге остаётся
  // («owner»), но носить её некому
  const { writes } = install({
    roles: [
      ...COVERED,
      { ...roleRow("owner", []), permission: JSON.stringify(staffAccessStatements()) },
    ],
    people: [person(1, "admin"), person(2, "half-a,half-b")],
  });

  await assert.rejects(rolesService.remove("admin", canAll), {
    statusCode: 409,
    message: FULL_ACCESS_MESSAGE,
  });
  assert.deepEqual(writes, []);
});

test("assign: taking the last holder's only role with an action is refused before any write", async () => {
  const { writes, data } = install(BASE);

  await assert.rejects(
    rolesService.assign(String(userIdOf(2)), ["engineer"], canAll),
    { statusCode: 409, message: orphanMessage(KB_ACTIONS) },
  );
  assert.deepEqual(writes, []);
  assert.equal(data.member.find((row) => row._id === "member-2").role, "engineer,kb");
});

test("assign: only a shrinking role set is checked", async () => {
  // Добавление роли ничьих прав не отнимает: состояние даже не читается —
  // назначение зовёт форма пользователя на каждое сохранение
  const added = install(BASE);
  const result = await rolesService.assign(
    String(userIdOf(3)),
    ["engineer", "kb"],
    canAll,
  );
  assert.deepEqual(result.roles, ["engineer", "kb"]);
  assert.equal(holdersLoaded(added.reads), false);

  // Сужение проверяется, но права инженера остаются у третьего — можно
  const shrunk = install(BASE);
  await rolesService.assign(String(userIdOf(2)), ["kb"], canAll);
  assert.equal(holdersLoaded(shrunk.reads), true);
  assert.equal(
    shrunk.data.member.find((row) => row._id === "member-2").role,
    "kb",
  );
});

test("assign: the last full-access holder keeps the existing message", async () => {
  // Оба порога сработали бы — прежний стоит раньше и точнее называет беду
  const { writes } = install({
    roles: [
      { ...roleRow("admin", []), permission: JSON.stringify(staffAccessStatements()) },
      roleRow("engineer", ["ticket.perform"]),
    ],
    people: [person(1, "admin"), person(2, "engineer")],
  });

  await assert.rejects(
    rolesService.assign(String(userIdOf(1)), ["engineer"], canAll),
    {
      statusCode: 409,
      message:
        "Это последний человек с полным доступом — снять его нельзя: вернуть полный доступ будет некому. Сначала выдайте роль администратора кому-то ещё",
    },
  );
  assert.deepEqual(writes, []);
});

test("assertNotLastFullAccessHolder: the last active full-access holder may not drop it", async () => {
  // Тот же порог, что в `assign`, — отдельно: форма человека задаёт его раньше
  // проверки носителей (controllers/user.js#update)
  const roles = [
    { ...roleRow("admin", []), permission: JSON.stringify(staffAccessStatements()) },
    roleRow("engineer", ["ticket.perform"]),
  ];
  const staffAccount = { isEndUser: false };
  const me = String(userIdOf(1));

  install({ roles, people: [person(1, "admin"), person(2, "engineer")] });
  await assert.rejects(
    assertNotLastFullAccessHolder(ORG, me, ["admin"], ["engineer"], staffAccount),
    {
      statusCode: 409,
      message:
        "Это последний человек с полным доступом — снять его нельзя: вернуть полный доступ будет некому. Сначала выдайте роль администратора кому-то ещё",
    },
  );

  // Есть второй действующий носитель полного доступа — можно; отключённый не в счёт
  install({ roles, people: [person(1, "admin"), person(2, "admin")] });
  await assertNotLastFullAccessHolder(ORG, me, ["admin"], ["engineer"], staffAccount);
  install({
    roles,
    people: [person(1, "admin"), person(2, "admin", { banned: true })],
  });
  await assert.rejects(
    assertNotLastFullAccessHolder(ORG, me, ["admin"], ["engineer"], staffAccount),
    { statusCode: 409 },
  );

  // Клиентская учётная запись порогом не связана — база даже не читается;
  // у сотрудника без полного доступа не читается членство
  const client = install({ roles, people: [person(1, "admin")] });
  await assertNotLastFullAccessHolder(ORG, me, ["admin"], [], { isEndUser: true });
  assert.deepEqual(client.reads, []);
  const plain = install({ roles, people: [person(1, "engineer")] });
  await assertNotLastFullAccessHolder(ORG, me, ["engineer"], [], staffAccount);
  assert.equal(plain.reads.some(([name]) => name === "member"), false);
});

test("update: cutting the only held action out of a role is refused before the write", async () => {
  const { writes, data } = install(BASE);

  await assert.rejects(
    rolesService.update("kb", { actions: ["knowledge.manage"] }, canAll),
    { statusCode: 409, message: orphanMessage(["knowledge.moderate"]) },
  );
  // Тот же набор, но роль отдана клиентам: сотрудникам она больше прав не даёт
  await assert.rejects(
    rolesService.update("kb", { actions: KB_ACTIONS, audience: "client" }, canAll),
    { statusCode: 409, message: orphanMessage(KB_ACTIONS) },
  );
  assert.deepEqual(writes, []);
  assert.equal(
    data.organizationRole.find((row) => row.role === "kb").permission,
    JSON.stringify(actionsToStatements(KB_ACTIONS)),
  );
});

test("update: renaming a role runs no check", async () => {
  const { writes, reads } = install(BASE);

  await rolesService.update("kb", { title: "База знаний" }, canAll);
  assert.equal(holdersLoaded(reads), false);
  assert.deepEqual(writes.map(([name, op]) => [name, op]), [
    ["organizationRole", "updateOne"],
  ]);
});

test("update: the last-keeper guard keeps its own message", async () => {
  const { writes } = install(BASE);

  await assert.rejects(
    rolesService.update("keeper", { actions: ["role.read", "user.read"] }, canAll),
    {
      statusCode: 409,
      message:
        "Это последняя роль с правом «role.manage» — без него управлять системой будет некому",
    },
  );
  assert.deepEqual(writes, []);
});

test("remove: deleting the only role with a held action is refused before any write", async () => {
  const { writes, data } = install(BASE);

  await assert.rejects(rolesService.remove("kb", canAll), {
    statusCode: 409,
    message: orphanMessage(KB_ACTIONS),
  });
  assert.deepEqual(writes, []);
  assert.ok(data.organizationRole.some((row) => row.role === "kb"));
  assert.equal(data.member.find((row) => row._id === "member-2").role, "engineer,kb");
});

test("remove: a role nobody holds goes without a refusal", async () => {
  const { writes } = install({
    roles: [...BASE.roles, roleRow("spare", ["supplier.manage"])],
    people: BASE.people,
  });

  await rolesService.remove("spare", canAll);
  assert.deepEqual(writes.at(-1), [
    "organizationRole",
    "deleteOne",
    { _id: "role-spare" },
  ]);
});

test("remove: the last-keeper guard keeps its own message", async () => {
  const { writes } = install(BASE);

  await assert.rejects(rolesService.remove("keeper", canAll), {
    statusCode: 409,
    message:
      "Это последняя роль с правом «role.manage» — без него управлять системой будет некому",
  });
  assert.deepEqual(writes, []);
});
