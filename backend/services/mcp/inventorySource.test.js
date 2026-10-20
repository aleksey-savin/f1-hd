require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { deviceTypeId, DEVICE_FIELDS } = require("./inventorySource");

test("deviceTypeId: тип берётся из модели", () => {
  const modelsById = new Map([["m1", { _id: "m1", deviceTypeId: "t1" }]]);
  assert.equal(deviceTypeId({ deviceModelId: "m1", deviceTypeId: "tX" }, modelsById), "t1");
});

test("deviceTypeId: без модели — собственный тип устройства", () => {
  assert.equal(deviceTypeId({ deviceTypeId: "t2" }, new Map()), "t2");
});

test("deviceTypeId: модели нет в карте и своего типа нет — null", () => {
  assert.equal(deviceTypeId({ deviceModelId: "m9" }, new Map()), null);
});

test("DEVICE_FIELDS не содержит секретов", () => {
  for (const secret of ["licenseKey", "macAddress", "machineId"]) {
    assert.ok(!DEVICE_FIELDS.includes(secret), secret);
  }
  assert.ok(DEVICE_FIELDS.includes("installedSoftware.name"));
});

test("ticketLinkFilter: служебные заявители не дают связи по человеку", () => {
  const devices = [
    { _id: "d1", userId: "u1" },
    { _id: "d2", userId: "robot" },
    { _id: "d3", userId: "u2", parentDeviceId: "d1" },
  ];
  const filter = require("./inventorySource").ticketLinkFilter(devices, { systemUserIds: ["robot"] });
  assert.deepEqual(filter.$or[1], { applicantId: { $in: ["u1"] } });
  assert.deepEqual(filter.$or[0].relatedClientDeviceId.$in, ["d1", "d2", "d3"]);
});

test("loadDevice: битый id даёт null", async () => {
  assert.equal(await require("./inventorySource").loadDevice("nope"), null);
});
