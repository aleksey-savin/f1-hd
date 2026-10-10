// node --test controllers/inventory/mikrotik.responsible.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
mongoose.set("bufferCommands", false);

const { parseResponsible } = require("./mikrotik");

test("responsibleId: поля нет — не менять; то же значение — без перепроверки (даже если право потеряно)", async () => {
  assert.deepEqual(await parseResponsible({}, "u1"), { change: false });
  assert.deepEqual(await parseResponsible({ responsibleId: "u1" }, "u1"), { change: false });
  assert.deepEqual(await parseResponsible({ responsibleId: null }, undefined), { change: false });
  assert.deepEqual(await parseResponsible({ responsibleId: "" }, null), { change: false });
});
