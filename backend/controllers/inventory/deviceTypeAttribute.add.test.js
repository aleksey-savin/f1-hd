// node --test controllers/inventory/deviceTypeAttribute.add.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
mongoose.set("bufferCommands", false);

const { parseAddItems, parseGroupId } = require("./deviceTypeAttribute");

const ID_A = "6a28ed8f6d333b3a785274e2";
const ID_B = "6a28ed8f6d333b3a785274e3";

test("пустая или не-массив пачка — ошибка", () => {
  assert.ok(parseAddItems([]).error);
  assert.ok(parseAddItems(undefined).error);
  assert.ok(parseAddItems({ attributeId: ID_A }).error);
});

test("порядок пачки сохраняется, повтор готового атрибута — один раз", () => {
  const { entries } = parseAddItems([
    { attributeId: ID_B },
    { attribute: { name: "Блок питания", valueType: "number", unit: " Вт " } },
    { attributeId: ID_A },
    { attributeId: ID_B },
  ]);
  assert.deepEqual(entries, [
    { attributeId: ID_B },
    {
      attribute: {
        name: "Блок питания",
        valueType: "number",
        unit: "Вт",
        options: [],
        isActive: true,
        scope: "model",
      },
    },
    { attributeId: ID_A },
  ]);
});

test("новый атрибут: уровень из пачки, без него — model, чужой — ошибка", () => {
  const { entries } = parseAddItems([
    { attribute: { name: "Дата производства", valueType: "date", scope: "device" } },
    { attribute: { name: "Цвет", valueType: "string" } },
  ]);
  assert.equal(entries[0].attribute.scope, "device");
  assert.equal(entries[0].attribute.valueType, "date");
  assert.equal(entries[1].attribute.scope, "model");
  assert.ok(parseAddItems([{ attribute: { name: "X", valueType: "string", scope: "type" } }]).error);
});

test("битый id — ошибка", () => {
  assert.ok(parseAddItems([{ attributeId: "nope" }]).error);
});

test("новый: нужно наименование и известный тип данных", () => {
  assert.ok(parseAddItems([{ attribute: { name: "  ", valueType: "string" } }]).error);
  assert.ok(parseAddItems([{ attribute: { name: "X", valueType: "datetime" } }]).error);
});

test("новый с тем же наименованием дважды (без учёта регистра) — ошибка", () => {
  const result = parseAddItems([
    { attribute: { name: "Сокет", valueType: "string" } },
    { attribute: { name: "сокет", valueType: "string" } },
  ]);
  assert.match(result.error, /дважды/);
});

test("выбор из списка: варианты обязательны, чистятся от пустых и повторов", () => {
  assert.ok(
    parseAddItems([{ attribute: { name: "Сокет", valueType: "select", options: [" "] } }]).error,
  );
  const { entries } = parseAddItems([
    {
      attribute: {
        name: "Сокет",
        valueType: "multiselect",
        options: ["AM4", { value: "AM5", label: "AM5" }, "AM4", ""],
        isActive: false,
      },
    },
  ]);
  assert.deepEqual(entries[0].attribute.options, [
    { value: "AM4", label: "AM4" },
    { value: "AM5", label: "AM5" },
  ]);
  assert.equal(entries[0].attribute.isActive, false);
});

test("не-списочный тип: присланные варианты отбрасываются", () => {
  const { entries } = parseAddItems([
    { attribute: { name: "Гарантия", valueType: "number", options: ["1"] } },
  ]);
  assert.deepEqual(entries[0].attribute.options, []);
});

test("parseGroupId: undefined — не менять, null и пустая строка — снять", () => {
  assert.deepEqual(parseGroupId(undefined), { groupId: undefined });
  assert.deepEqual(parseGroupId(null), { groupId: null });
  assert.deepEqual(parseGroupId(""), { groupId: null });
});

test("parseGroupId: валидный id — строкой, мусор — ошибка", () => {
  assert.deepEqual(parseGroupId(ID_A), { groupId: ID_A });
  assert.ok(parseGroupId("nope").error);
  assert.ok(parseGroupId(123).error);
});
