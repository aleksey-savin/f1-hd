const { test } = require("node:test");
const assert = require("node:assert/strict");

const { codeFromName, pickFreeCode } = require("./attributeCode");

test("codeFromName: кириллица транслитерируется, слова через _", () => {
  assert.equal(codeFromName("Оперативная память"), "operativnaya_pamyat");
  assert.equal(codeFromName("Объём накопителя, ГБ"), "obyom_nakopitelya_gb");
});

test("codeFromName: латиница и цифры остаются, регистр нижний", () => {
  assert.equal(codeFromName("Wi-Fi 6E"), "wi_fi_6e");
  assert.equal(codeFromName("  CPU  "), "cpu");
});

test("codeFromName: без латинизируемых знаков — запасной код", () => {
  assert.equal(codeFromName("—"), "attribute");
  assert.equal(codeFromName(""), "attribute");
});

test("codeFromName: длина ограничена, хвостового _ нет", () => {
  const code = codeFromName("очень ".repeat(20));
  assert.ok(code.length <= 48);
  assert.ok(!code.endsWith("_"));
});

test("pickFreeCode: свободный базовый, иначе первый свободный суффикс", () => {
  assert.equal(pickFreeCode("ram", []), "ram");
  assert.equal(pickFreeCode("ram", ["ram"]), "ram_2");
  assert.equal(pickFreeCode("ram", ["ram", "ram_2", "ram_3"]), "ram_4");
  assert.equal(pickFreeCode("ram", ["ram", "ram_3"]), "ram_2");
});
