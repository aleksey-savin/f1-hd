// node --test validations/inventory/clientDevice.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");

const { clientDeviceValidation } = require("./clientDevice");

const errorsFor = async (body, path) => {
  const req = { body };
  for (const chain of clientDeviceValidation) await chain.run(req);
  return validationResult(req)
    .array()
    .filter((e) => e.path === path)
    .map((e) => e.msg);
};

test("macAddress агента — та же проверка, что у поля в форме", async () => {
  assert.deepEqual(await errorsFor({ macAddress: "AA:BB:CC:DD:EE:FF" }, "macAddress"), []);
  assert.deepEqual(await errorsFor({ macAddress: "aa-bb-cc-dd-ee-ff" }, "macAddress"), []);
  // Форма такое не примет — значит, и агент не пишет
  assert.deepEqual(await errorsFor({ macAddress: "aabb.ccdd.eeff" }, "macAddress"), ["Некорректный MAC-адрес"]);
  assert.deepEqual(await errorsFor({ macAddress: "aa bb cc dd ee ff" }, "macAddress"), ["Некорректный MAC-адрес"]);
});
