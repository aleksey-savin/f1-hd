// node --test services/actionMigration.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { flattenStatements, conversationGrants } = require("./actionMigration");

test("flattenStatements", () => {
  assert.deepEqual(flattenStatements({ ticket: ["perform", "delete"], role: ["read"] }), [
    "ticket.perform",
    "ticket.delete",
    "role.read",
  ]);
});

test("conversation grants follow ticket work, never outside performers or clients", () => {
  const role = (key, actions, audience = "staff") => ({ key, audience, actions });

  // Администратор ведёт заявки — получает все три и остаётся полным доступом
  assert.deepEqual(
    conversationGrants(role("admin", ["ticket.perform", "ticket.manage"])),
    ["conversation.read", "conversation.reply", "conversation.manage"],
  );
  // Первая и вторая линия берут заявки — читают и отвечают
  assert.deepEqual(conversationGrants(role("it-first-line", ["ticket.perform"])), [
    "conversation.read",
    "conversation.reply",
  ]);
  // Сторонний исполнитель — нет
  assert.deepEqual(conversationGrants(role("contractor-no-works", ["ticket.perform"])), []);
  // Модератор базы знаний заявок не берёт — переписки нет
  assert.deepEqual(conversationGrants(role("kb-moderator", ["knowledge.moderate"])), []);
  // Клиентской роли действия сотрудника не выдаются
  assert.deepEqual(conversationGrants(role("client-admin", ["ticket.perform"], "client")), []);
  // Повторный прогон ничего не добавляет
  assert.deepEqual(
    conversationGrants(role("it-first-line", ["ticket.perform", "conversation.read", "conversation.reply"])),
    [],
  );
});
