import test from "node:test";
import assert from "node:assert/strict";
import * as navigation from "./menu.js";

const items = [
  { key: "dashboard", to: "/dashboard" },
  { key: "tickets", to: "/tickets" },
  {
    key: "admin",
    groups: [
      { items: [{ key: "checklists", to: "/tickets/checklist-templates" }] },
    ],
  },
];

test("navigation selects the deepest route across sections", () => {
  assert.equal(
    navigation.activeMenuKey(items, "/tickets/checklist-templates/add"),
    "checklists",
  );
  assert.equal(navigation.activeMenuKey(items, "/tickets/123"), "tickets");
});

test("navigation matches route boundaries and the dashboard alias", () => {
  assert.equal(navigation.activeMenuKey(items, "/tickets-other"), undefined);
  assert.equal(navigation.activeMenuKey(items, "/"), "dashboard");
  assert.equal(navigation.activeMenuKey([], "/"), undefined);
});
