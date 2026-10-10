// node --test services/mikrotik/recordChanges.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { parameterChanges } = require("./recordChanges");

const base = { host: "10.0.0.1", port: 8729, user: "hd", sshPort: 22, label: null, firmwareUpgradeEnabled: false, transit: null, company: "c1", responsible: null, password: "old", knock: "" };

test("an unchanged save reports nothing", () => {
  assert.deepEqual(parameterChanges(base, { ...base, port: "8729" }), { fields: [], responsible: null, any: false });
});

test("plain fields carry both values", () => {
  const { fields } = parameterChanges(base, { ...base, host: "10.0.0.2", firmwareUpgradeEnabled: true });
  assert.deepEqual(fields, [
    { field: "host", from: "10.0.0.1", to: "10.0.0.2" },
    { field: "firmwareUpgradeEnabled", from: false, to: true },
  ]);
});

test("secrets and references are named without values", () => {
  const result = parameterChanges(base, { ...base, password: "new", knock: "[1,2]", transit: "r9", company: "c2" });
  assert.deepEqual(result.fields, [{ field: "transit" }, { field: "company" }, { field: "password" }, { field: "knock" }]);
  assert.ok(!JSON.stringify(result).includes("new"));
});

test("a responsible change is reported with both ids", () => {
  assert.deepEqual(parameterChanges(base, { ...base, responsible: "u2" }).responsible, { from: null, to: "u2" });
  assert.deepEqual(parameterChanges({ ...base, responsible: "u1" }, { ...base, responsible: null }).responsible, { from: "u1", to: null });
});

test("a field absent from the save is not a change", () => {
  const { any } = parameterChanges(base, { host: "10.0.0.1" });
  assert.equal(any, false);
});
