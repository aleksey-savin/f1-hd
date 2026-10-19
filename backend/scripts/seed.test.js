// node --test scripts/seed.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { pendingSeeds, SEEDS } = require("./seed");

const list = [
  { id: "2026-10-19-a", module: "seeds/a.js" },
  { id: "2026-10-20-b", module: "seeds/b.js" },
  { id: "2026-10-21-c", module: "seeds/c.js" },
];

test("ожидающие — только неприменённые, в порядке списка", () => {
  assert.deepEqual(
    pendingSeeds(list, ["2026-10-21-c", "2026-10-19-a"]).map((s) => s.id),
    ["2026-10-20-b"],
  );
  assert.deepEqual(pendingSeeds(list, []).map((s) => s.id), list.map((s) => s.id));
});

test("применённый сид не возвращается — переименованное владельцем не воскресает", () => {
  assert.deepEqual(pendingSeeds(list, list.map((s) => s.id)), []);
});

test("лишние записи в журнале не мешают", () => {
  assert.deepEqual(pendingSeeds(list, ["gone", "2026-10-19-a"]).map((s) => s.id), [
    "2026-10-20-b",
    "2026-10-21-c",
  ]);
});

test("список: уникальные id, у каждого модуль с apply", () => {
  const ids = SEEDS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const seed of SEEDS) {
    const mod = require(`./${seed.module}`);
    assert.equal(typeof mod.apply, "function", seed.id);
  }
});
