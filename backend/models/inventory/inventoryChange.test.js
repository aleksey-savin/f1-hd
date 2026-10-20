// node --test models/inventory/inventoryChange.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const InventoryChange = require("./inventoryChange");

test("пустое предложение: нужны заявитель и номер, статус по умолчанию", () => {
  const err = new InventoryChange({}).validateSync();
  assert.ok(err.errors.requestedBy && err.errors.number);
  const doc = new InventoryChange({ number: 1, requestedBy: new mongoose.Types.ObjectId() });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.status, "awaiting_requester");
});

test("операция хранит снимок каскада и targets", () => {
  const id = new mongoose.Types.ObjectId();
  const doc = new InventoryChange({
    number: 2,
    requestedBy: id,
    operations: [
      { kind: "moveDevice", params: { device: String(id) }, targets: [{ model: "ClientDevice", id, updatedAt: new Date() }], componentIds: [id] },
      { kind: "createVendor", params: { name: "X" } },
    ],
  });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.operations[0].componentIds.length, 1);
  assert.equal(doc.operations[1].componentIds, undefined);
  assert.equal(doc.operations[1].result.state, "pending");
  assert.equal(new InventoryChange({ number: 3, requestedBy: id, status: "cancelled" }).validateSync().errors.status.kind, "enum");
});

test("stuck: булево, по умолчанию не задано", () => {
  const id = new mongoose.Types.ObjectId();
  assert.equal(new InventoryChange({ number: 9, requestedBy: id }).stuck, undefined);
  assert.equal(new InventoryChange({ number: 9, requestedBy: id, stuck: true }).stuck, true);
});
