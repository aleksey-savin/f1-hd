// node --test services/inventory/attributeValue.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isValidValue } = require("./attributeValue");
const findings = require("../mcp/inventoryFindings");

test("isValidValue: по типу значения", () => {
  const select = { valueType: "select", options: [{ value: "DDR4" }] };
  assert.equal(isValidValue(select, "DDR4"), true);
  assert.equal(isValidValue(select, "DDR5"), false);
  assert.equal(isValidValue({ valueType: "number" }, "4,5"), true);
  assert.equal(isValidValue({ valueType: "number" }, "abc"), false);
  assert.equal(isValidValue({ valueType: "boolean" }, "Да"), true);
  assert.equal(isValidValue({ valueType: "boolean" }, "maybe"), false);
  assert.equal(isValidValue({ valueType: "string" }, "что угодно"), true);
});

test("isValidValue: пустое значение — «не задано», это не ошибка", () => {
  assert.equal(isValidValue({ valueType: "number" }, "  "), true);
  assert.equal(isValidValue({ valueType: "select", options: [] }, undefined), true);
});

test("isValidValue: multiselect — каждое значение из вариантов", () => {
  const multi = { valueType: "multiselect", options: [{ value: "a" }, { value: "b" }] };
  assert.equal(isValidValue(multi, JSON.stringify(["a", "b"])), true);
  assert.equal(isValidValue(multi, JSON.stringify(["a", "z"])), false);
});

test("inventoryFindings по-прежнему отдаёт isValidValue", () => {
  assert.equal(findings.isValidValue, isValidValue);
});
