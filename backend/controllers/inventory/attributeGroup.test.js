// node --test controllers/inventory/attributeGroup.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
mongoose.set("bufferCommands", false);

const { parseGroupName } = require("./attributeGroup");

test("имя обрезается по краям", () => {
  assert.deepEqual(parseGroupName("  Процессор "), { name: "Процессор" });
});

test("повторные пробелы внутри схлопываются", () => {
  assert.deepEqual(parseGroupName("Оперативная   память"), {
    name: "Оперативная память",
  });
});

test("пустое имя — ошибка", () => {
  assert.ok(parseGroupName("").error);
  assert.ok(parseGroupName("   ").error);
  assert.ok(parseGroupName(null).error);
  assert.ok(parseGroupName(undefined).error);
});

test("80 символов — можно, 81 — ошибка", () => {
  assert.deepEqual(parseGroupName("а".repeat(80)), { name: "а".repeat(80) });
  assert.ok(parseGroupName("а".repeat(81)).error);
});
