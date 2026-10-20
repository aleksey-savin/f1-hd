// node --test services/inventory/attachRules.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isAttachableType, filterAttachable } = require("./attachRules");

test("isAttachableType: нет типа или флагов — нельзя", () => {
  assert.equal(isAttachableType(null), false);
  assert.equal(isAttachableType({}), false);
});

test("isAttachableType: любой из трёх флагов подходит", () => {
  assert.equal(isAttachableType({ isComponent: true }), true);
  assert.equal(isAttachableType({ isConsumable: true }), true);
  assert.equal(isAttachableType({ isPeripheral: true }), true);
});

test("isAttachableType: attachableToTypeIds сверяется с типом хоста", () => {
  const t = { isPeripheral: true, attachableToTypeIds: ["pc"] };
  assert.equal(isAttachableType(t, "pc"), true);
  assert.equal(isAttachableType(t, "srv"), false);
  assert.equal(isAttachableType(t), true);
});

test("filterAttachable: отбрасывает сборки, неизвестные и неподходящие типы", () => {
  const typeById = new Map([
    ["ram", { isComponent: true }],
    ["mouse", { isPeripheral: true }],
    ["desk", {}],
  ]);
  const devs = [
    { _id: "a", t: "ram" },
    { _id: "b", t: "ram" }, // сборка
    { _id: "c", t: "ghost" }, // неизвестный тип
    { _id: "d", t: "desk" }, // не прикрепляемый
    { _id: "e", t: null },
    { _id: "f", t: "mouse" },
  ];
  const res = filterAttachable({
    candidates: devs,
    typeOf: (d) => d.t,
    typeById,
    assemblyIds: new Set(["b"]),
  });
  assert.deepEqual(res.map((d) => d._id), ["a", "f"]);
});
