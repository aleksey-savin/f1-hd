// node --test services/actionMigration.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { migrateActions, flattenStatements } = require("./actionMigration");

test("renames and merges by the spec's map", () => {
  assert.deepEqual(
    migrateActions([
      "ticket.readCompany",
      "ticket.administrate",
      "ticket.update",
      "report.works",
      "settings.read",
      "settings.manageMail",
      "work.manageAll",
    ]),
    ["ticket.readCompanies", "ticket.manage", "work.read", "work.manage", "settings.manage"],
  );
});

test("read/manage splits and approval.read derive from manage rights", () => {
  assert.deepEqual(migrateActions(["routineTask.manage", "approval.manage"]), [
    "routineTask.read",
    "routineTask.manage",
    "approval.read",
    "approval.manage",
  ]);
  assert.deepEqual(migrateActions(["approval.decide"]), ["approval.read", "approval.decide"]);
});

test("cost and finances derive from the old combinations", () => {
  assert.deepEqual(migrateActions(["servicePlan.read", "report.employees"]), [
    "work.readCost",
    "report.employees",
    "servicePlan.read",
    "user.manageFinances",
  ]);
  assert.deepEqual(migrateActions(["servicePlan.read"]), ["servicePlan.read"]);
});

test("perform keeps the right to join others' tickets", () => {
  // Право присоединяться отделено от `ticket.perform` 2026-09-12; переезд
  // ничего не отнимает — иначе исполнители разом потеряли бы «Принять в работу»
  assert.deepEqual(migrateActions(["ticket.perform"]), [
    "ticket.perform",
    "ticket.join",
  ]);
  // Само по себе `ticket.join` из ничего не выводится
  assert.deepEqual(migrateActions(["ticket.delete"]), ["ticket.delete"]);
});

test("idempotent and drops unknown ids", () => {
  const once = migrateActions(["ticket.perform", "foo.bar", "ticket.readCompany"]);
  assert.deepEqual(once, ["ticket.readCompanies", "ticket.perform", "ticket.join"]);
  assert.deepEqual(migrateActions(once), once);
});

test("flattenStatements", () => {
  assert.deepEqual(flattenStatements({ ticket: ["perform", "delete"], role: ["read"] }), [
    "ticket.perform",
    "ticket.delete",
    "role.read",
  ]);
});
