import { test } from "node:test";
import assert from "node:assert/strict";
import { accessChanged } from "./access-refresh.ts";

test("a changed pulse refreshes the same user's permissions once the loader is stale", () => {
  assert.equal(accessChanged({ _id: "u1", accessVersion: "before" }, { userId: "u1", version: "after" }), true);
  assert.equal(accessChanged({ _id: "u1", accessVersion: "after" }, { userId: "u1", version: "after" }), false);
});

test("an old account's pulse or a response without access metadata cannot refresh another account", () => {
  const user = { _id: "u2", accessVersion: "current" };
  for (const access of [null, { userId: "u1", version: "old" }, { userId: "u2", version: "" }]) {
    assert.equal(accessChanged(user, access), false);
  }
});
