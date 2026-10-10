// node --test src/util/mikrotik-responsible.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { responsiblePatch } from "./mikrotik-responsible.ts";

test("untouched field is omitted", () => {
  assert.deepEqual(responsiblePatch({ initial: "u1", current: "u1" }), {});
  assert.deepEqual(responsiblePatch({ initial: "", current: "" }), {});
});

test("changed to another id sends that id", () => {
  assert.deepEqual(responsiblePatch({ initial: "u1", current: "u2" }), { responsibleId: "u2" });
  assert.deepEqual(responsiblePatch({ initial: "", current: "u2" }), { responsibleId: "u2" });
});

test("cleared by the person sends null", () => {
  assert.deepEqual(responsiblePatch({ initial: "u1", current: "" }), { responsibleId: null });
});

test("unknown initial value (record not loaded) is omitted", () => {
  assert.deepEqual(responsiblePatch({ initial: undefined, current: "" }), {});
  assert.deepEqual(responsiblePatch({ initial: undefined, current: "u2" }), {});
});
