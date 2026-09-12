// node --test src/components/Role/audience.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { groupsForAudience, foreignActions, hintFor } from "./audience.js";

const groups = [
  {
    key: "tickets",
    label: "Заявки",
    actions: [
      { id: "ticket.readCompanies", label: "Видеть заявки своих компаний", audience: "both", hint: "s", clientHint: "c" },
      { id: "ticket.perform", label: "Брать заявки в работу", audience: "staff", hint: "p" },
    ],
  },
  { key: "approval", label: "Согласование", actions: [{ id: "approval.decide", label: "Согласовывать отчёты", audience: "client" }] },
  { key: "settings", label: "Настройки", actions: [{ id: "settings.manage", label: "Изменять настройки" }] },
];

test("staff role: staff and both rows, client-only group hidden", () => {
  const staff = groupsForAudience(groups, "staff");
  assert.deepEqual(staff.map((g) => g.key), ["tickets", "settings"]);
  assert.deepEqual(staff[0].actions.map((a) => a.id), ["ticket.readCompanies", "ticket.perform"]);
});

test("client role: client and both rows, empty groups dropped", () => {
  const client = groupsForAudience(groups, "client");
  assert.deepEqual(client.map((g) => g.key), ["tickets", "approval"]);
  assert.deepEqual(client[0].actions.map((a) => a.id), ["ticket.readCompanies"]);
});

test("foreignActions lists what a switch removes", () => {
  assert.deepEqual(foreignActions(["ticket.readCompanies", "ticket.perform", "settings.manage"], groups, "client"), ["ticket.perform", "settings.manage"]);
  assert.deepEqual(foreignActions(["approval.decide", "ticket.readCompanies"], groups, "staff"), ["approval.decide"]);
});

test("hintFor picks the client hint only for client roles", () => {
  const both = groups[0].actions[0];
  assert.equal(hintFor(both, "client"), "c");
  assert.equal(hintFor(both, "staff"), "s");
  assert.equal(hintFor(groups[0].actions[1], "client"), "p");
  assert.equal(hintFor({ id: "x", label: "y" }, "staff"), "");
});
