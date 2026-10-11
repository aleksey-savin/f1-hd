require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { ALL_ACTIONS, actionsToStatements, isFullAccess } = require("@/auth/access");
const { CATALOGUE } = require("./syncRoleCatalogue");

const raw = fs.readFileSync(CATALOGUE, "utf8");
const { roles } = JSON.parse(raw);

// Каталог едет в поставку: это набор ролей продукта, а не раздача одной установки.
const SHIPPED_KEYS = [
  "client",
  "client-admin",
  "client-manager",
  "admin",
  "it-first-line",
  "it-second-line",
  "kb-moderator",
  "contractor-no-works",
];

test("в каталоге нет адресов почты", () => {
  assert.ok(!raw.includes("@"), "в файле каталога остался символ @");
});

test("у ролей нет данных раздачи конкретной установки", () => {
  for (const role of roles) {
    for (const field of ["members", "matches", "_note"]) {
      assert.ok(!(field in role), `роль «${role.key}» несёт поле ${field}`);
    }
  }
});

test("состав каталога — ровно роли поставки", () => {
  assert.deepEqual(
    roles.map((role) => role.key).sort(),
    [...SHIPPED_KEYS].sort(),
  );
});

test("у каждой роли есть название и адресат", () => {
  for (const role of roles) {
    assert.ok(role.title && role.title.trim(), `роль «${role.key}» без названия`);
    assert.ok(
      ["client", "staff"].includes(role.audience),
      `роль «${role.key}»: неизвестный адресат ${role.audience}`,
    );
    assert.ok(Array.isArray(role.actions), `роль «${role.key}» без списка действий`);
  }
});

test("полный доступ даёт ровно одна роль", () => {
  const full = roles.filter((role) =>
    isFullAccess(actionsToStatements(role.actions)),
  );
  assert.deepEqual(full.map((role) => role.key), ["admin"]);
});

test("каждое действие каталога есть в словаре прав", () => {
  for (const role of roles) {
    const unknown = role.actions.filter((id) => !ALL_ACTIONS.includes(id));
    assert.deepEqual(unknown, [], `роль «${role.key}»: действий нет в словаре`);
  }
});
