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

test("loadDevice: IP и ОС — из атрибутов устройства, MAC и сами attributes не отдаются", async (t) => {
  const mongoose = require("mongoose");
  mongoose.set("bufferCommands", false);
  const ClientDevice = require("@/models/inventory/clientDevice");
  const DeviceAttribute = require("@/models/inventory/deviceAttribute");
  const OS = "aaaaaaaaaaaaaaaaaaaaaa01";
  const IP = "aaaaaaaaaaaaaaaaaaaaaa02";
  const MAC = "aaaaaaaaaaaaaaaaaaaaaa03";
  const query = (value) => {
    const q = { select: () => q, lean: async () => value };
    return q;
  };
  let selected = "";
  t.mock.method(ClientDevice, "findOne", () => {
    const q = query({
      _id: "66cc00000000000000000001",
      hostname: "GW-01",
      attributes: [
        { attributeId: OS, value: "RouterOS 7.21.3 (stable)" },
        { attributeId: IP, value: "10.0.0.1" },
        { attributeId: MAC, value: "AA:BB:CC:DD:EE:FF" },
      ],
    });
    q.select = (fields) => {
      selected = fields;
      return q;
    };
    return q;
  });
  t.mock.method(DeviceAttribute, "find", () =>
    query([
      { _id: OS, code: "operatingsystem", name: "Операционная система" },
      { _id: IP, code: "ip_address", name: "IP-адрес" },
      { _id: MAC, code: "mac_address", name: "MAC-адрес" },
    ]),
  );
  const device = await require("./inventorySource").loadDevice("66cc00000000000000000001");
  assert.equal(device.ipAddress, "10.0.0.1");
  assert.equal(device.operatingSystem, "RouterOS 7.21.3 (stable)");
  assert.equal(device.attributes, undefined);
  assert.ok(!JSON.stringify(device).includes("AA:BB"), "MAC утёк");
  assert.match(selected, /attributes/);
});
