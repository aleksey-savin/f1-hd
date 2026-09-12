// node --test services/roles.test.js
//
// Пороги правки каталога ролей — их чистые части. Сами `update`, `remove` и
// `assign` без базы не проверить (роли и членство лежат в коллекциях плагина),
// поэтому проверяется то, что решает: какое несущее право роль теряет
// (`lastKeeperLoss` — список остальных ролей приходит параметром) и подходит ли
// роль учётной записи по адресату (`assertRoleFitsAccount`).
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { staffAccessStatements } = require("@/auth/access");
const {
  lastKeeperLoss,
  losesLastFullAccess,
  staffSideOf,
  assertRoleFitsAccount,
} = require("./roles");

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
