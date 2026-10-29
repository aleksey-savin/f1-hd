// node --test services/mikrotik/reconciliation.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { computeReconciliation } = require("./reconciliation");

const ids = { os: "os1", ip: "ip1", mac: "mac1" };
const record = {
  currentFirmware: "7.21.3 (stable)",
  credentials: { host: "10.0.0.1" },
  addresses: [{ address: "192.168.88.1/24", disabled: "false" }],
};
const fields = (result) => result.mismatches.map((m) => m.field);

test("сверка: IP и ОС берутся из атрибутов устройства", () => {
  const device = {
    attributes: [
      { attributeId: "os1", value: "RouterOS 7.21.3 (stable)" },
      { attributeId: "ip1", value: "192.168.88.1" },
    ],
  };
  assert.deepEqual(fields(computeReconciliation(device, record, ids)), []);
});

test("сверка: расхождение IP, когда в атрибуте другой адрес", () => {
  const device = {
    attributes: [
      { attributeId: "os1", value: "RouterOS 7.21.3 (stable)" },
      { attributeId: "ip1", value: "172.16.0.9" },
    ],
  };
  const result = computeReconciliation(device, record, ids);
  assert.deepEqual(fields(result), ["ipAddress"]);
  assert.equal(result.mismatches[0].cardValue, "172.16.0.9");
  assert.equal(result.mismatches[0].deviceValue, "10.0.0.1");
});

test("сверка: пустые атрибуты — расхождение ОС и IP", () => {
  assert.deepEqual(fields(computeReconciliation({}, record, ids)), ["operatingSystem", "ipAddress"]);
});
