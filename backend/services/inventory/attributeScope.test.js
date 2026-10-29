// node --test services/inventory/attributeScope.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SCOPE,
  isDeviceScoped,
  splitLinks,
  deviceScopedValueError,
  scopeChangeError,
} = require("./attributeScope");

const ip = { _id: "a1", name: "IP-адрес", scope: "device" };
const ram = { _id: "a2", name: "Оперативная память", scope: "model" };
const legacy = { _id: "a3", name: "Процессор" }; // без поля — модель

test("isDeviceScoped: только явный device", () => {
  assert.equal(DEFAULT_SCOPE, "model");
  assert.equal(isDeviceScoped(ip), true);
  assert.equal(isDeviceScoped(ram), false);
  assert.equal(isDeviceScoped(legacy), false);
  assert.equal(isDeviceScoped(null), false);
});

test("splitLinks: раскладка по уровню populated-атрибута", () => {
  const links = [
    { _id: "l1", attributeId: ip },
    { _id: "l2", attributeId: ram },
    { _id: "l3", attributeId: "a9" }, // не populated — модель
    { _id: "l4", attributeId: legacy },
  ];
  const { model, device } = splitLinks(links);
  assert.deepEqual(device.map((l) => l._id), ["l1"]);
  assert.deepEqual(model.map((l) => l._id), ["l2", "l3", "l4"]);
});

test("deviceScopedValueError: первый атрибут уровня устройства — текст 400", () => {
  const attrs = new Map([
    ["a1", ip],
    ["a2", ram],
  ]);
  assert.equal(
    deviceScopedValueError([{ attributeId: "a2" }, { attributeId: "a1" }], attrs),
    "Атрибут «IP-адрес» задаётся у каждого устройства, а не у модели",
  );
  assert.equal(deviceScopedValueError([{ attributeId: "a2" }], attrs), null);
  assert.equal(deviceScopedValueError([{ attributeId: "zz" }], attrs), null);
});

test("scopeChangeError: уровень не меняется при значениях", () => {
  const msg = "У атрибута «Оперативная память» уже есть значения — уровень не меняется";
  assert.equal(scopeChangeError(ram, "device", { configValues: 1, deviceValues: 0 }), msg);
  assert.equal(
    scopeChangeError(ip, "model", { configValues: 0, deviceValues: 2 }),
    "У атрибута «IP-адрес» уже есть значения — уровень не меняется",
  );
  assert.equal(scopeChangeError(ram, "model", { configValues: 5, deviceValues: 0 }), null);
  assert.equal(scopeChangeError(ram, "device", { configValues: 0, deviceValues: 3 }), null);
  assert.equal(scopeChangeError(legacy, "model", { configValues: 1, deviceValues: 0 }), null);
});
