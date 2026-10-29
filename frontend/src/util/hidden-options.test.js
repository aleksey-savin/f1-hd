// node --test src/util/hidden-options.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { visibleOptions } from "./hidden-options.ts";

const items = [
  { _id: "a", name: "активный", isActive: true },
  { _id: "b", name: "скрытый", isActive: false },
  { _id: "c", name: "удалённая", deletedAt: "2026-10-20T00:00:00.000Z" },
  { _id: "d", name: "без флагов" },
  { _id: "e", name: "не удалена", deletedAt: null },
];

test("visibleOptions: скрытые убраны, текущее значение оставлено", () => {
  assert.deepEqual(
    visibleOptions(items, []).map((item) => item._id),
    ["a", "d", "e"],
  );
  assert.deepEqual(
    visibleOptions(items, ["b", "c"]).map((item) => item._id),
    ["a", "b", "c", "d", "e"],
  );
  // id из populate-объекта и пустые значения не ломают отбор
  assert.deepEqual(
    visibleOptions(items, ["", undefined, "x"]).map((item) => item._id),
    ["a", "d", "e"],
  );
  assert.deepEqual(visibleOptions(undefined, []), []);
});
