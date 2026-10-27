// node --test src/components/ClientDevice/model-config.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { configFieldMode } from "./model-config.ts";

test("configFieldMode: несколько — выбор, одна — сводка, нет — ничего", () => {
  assert.equal(configFieldMode([{}, {}]), "picker");
  assert.equal(configFieldMode([{}]), "summary");
  assert.equal(configFieldMode([]), null);
  assert.equal(configFieldMode(null), null);
});
