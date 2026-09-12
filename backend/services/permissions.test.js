// node --test services/permissions.test.js
//
// Проверяется ОДНА ветка `effectivePermissions` — администраторская: она
// отвечает до всякого обращения к базе, поэтому проверяема без Mongo. Остальные
// пути (роли из `organizationRole`, членство) без базы не живут, а правило
// «зеркало действует только у сотрудника» проверяется у самого предиката
// (`auth/access.js#isStaffAdmin`, тест в auth/access.test.js) — оба места читают
// именно его.
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { effectivePermissions, canFor } = require("./permissions");

test("a staff admin gets the whole staff dictionary and may grant client actions", async () => {
  const { statements, grantStatements } = await effectivePermissions({
    _id: "000000000000000000000001",
    isEndUser: false,
    isAdmin: true,
  });

  // Действует у него весь словарь сотрудника — но не клиентская подпись
  assert.deepEqual(statements.approval, ["read", "manage"]);
  assert.deepEqual(statements.settings, ["manage"]);

  // А выдать клиентской роли «Согласовывать отчёты» он обязан уметь: именно на
  // этом форма пользователя отказывала «Нельзя выдать роли права, которых нет
  // у вас: approval.decide».
  assert.ok(grantStatements.approval.includes("decide"));
});

// Проекция без `isEndUser` — та самая ошибка, из-за которой табель приходил без
// `canManage`, а отсутствие коллеге не заводилось: `accountAudienceOf` считал
// такой документ клиентским и вырезал все права сотрудника. Проверка стоит ДО
// обращения к базе, поэтому тест обходится без Mongo.
test("canFor refuses a projected document without isEndUser", async () => {
  await assert.rejects(
    () => canFor({ _id: "000000000000000000000001", isAdmin: false }),
    /canFor: нужен полный документ пользователя с isEndUser/,
  );
});
