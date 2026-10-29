// node --test controllers/inventory/mikrotik.inventoryCard.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mongoose = require("mongoose");
// Базы нет: забытая подмена падает сразу, а не висит в буфере
mongoose.set("bufferCommands", false);

// models/ticket.js на верхнем уровне зовёт initCounter() — без базы это шум
const stubModule = (path, exportsValue) => {
  const resolved = require.resolve(path);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exportsValue;
  require.cache[resolved] = stub;
};
stubModule("@/models/ticket", { Ticket: {} });

const Mikrotik = require("@/models/mikrotik");
const ClientDevice = require("@/models/inventory/clientDevice");
const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const Vendor = require("@/models/inventory/vendor");
const Preferences = require("@/models/preferences");
const MikrotikEvent = require("@/models/mikrotikEvent");
const DeviceAttribute = require("@/models/inventory/deviceAttribute");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");

const { createInventoryCard } = require("./mikrotik");

const REC = "eeeeeeeeeeeeeeeeeeeeeee1";
const M1 = "bbbbbbbbbbbbbbbbbbbbbbb1";
const C1 = "cccccccccccccccccccccc01";
const ROUTER = "dddddddddddddddddddddd01";
const OS = "aaaaaaaaaaaaaaaaaaaaaa01";
const IP = "aaaaaaaaaaaaaaaaaaaaaa02";
const MAC = "aaaaaaaaaaaaaaaaaaaaaa03";

// Цепочка запроса: .select/.sort/.lean возвращают её же, await — значение
const chain = (value) => {
  const q = {
    select: () => q,
    sort: () => q,
    lean: () => q,
    distinct: async () => [],
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
};

test("карточка из записи Mikrotik: модель с единственной конфигурацией — устройство привязано к ней", async (t) => {
  const record = new Mikrotik({ _id: REC, boardName: "RB4011iGS+" });
  t.mock.method(record, "save", async () => record);
  t.mock.method(Mikrotik, "findById", async () => record);
  t.mock.method(Preferences, "findOne", () => chain(null));
  t.mock.method(ClientDevice, "findOne", () => chain(null));
  t.mock.method(Vendor, "find", () => chain([]));
  t.mock.method(DeviceModel, "find", () => chain([{ _id: M1, name: "RB4011iGS+" }]));
  t.mock.method(DeviceModel, "findOne", () => chain({ _id: M1, multiConfig: false }));
  t.mock.method(DeviceConfiguration, "find", () => chain([{ _id: C1, values: [] }]));
  t.mock.method(MikrotikEvent, "create", async () => ({}));
  let saved;
  t.mock.method(ClientDevice.prototype, "save", async function save() {
    saved = this;
    return this;
  });

  const res = { status: () => res, json: () => res };
  let failed;
  await createInventoryCard({ params: { recordId: REC }, userId: undefined }, res, (e) => {
    failed = e;
  });

  assert.ifError(failed);
  assert.equal(String(saved.deviceModelId), M1);
  assert.equal(String(saved.configurationId), C1);
});

test("карточка из записи Mikrotik: ОС и IP — в атрибуты, типу модели добавлены связки", async (t) => {
  const record = new Mikrotik({
    _id: REC,
    boardName: "RB4011iGS+",
    currentFirmware: "7.21.3 (stable)",
    credentials: { host: "10.0.0.1" },
  });
  t.mock.method(record, "save", async () => record);
  t.mock.method(Mikrotik, "findById", async () => record);
  t.mock.method(Preferences, "findOne", () => chain(null));
  t.mock.method(ClientDevice, "findOne", () => chain(null));
  t.mock.method(Vendor, "find", () => chain([]));
  t.mock.method(DeviceModel, "find", () => chain([{ _id: M1, name: "RB4011iGS+", deviceTypeId: ROUTER }]));
  t.mock.method(DeviceModel, "findOne", () => chain({ _id: M1, multiConfig: false }));
  t.mock.method(DeviceConfiguration, "find", () => chain([{ _id: C1, values: [] }]));
  t.mock.method(MikrotikEvent, "create", async () => ({}));
  t.mock.method(DeviceAttribute, "find", () =>
    chain([
      { _id: OS, code: "operatingsystem", name: "Операционная система" },
      { _id: IP, code: "ip_address", name: "IP-адрес" },
      { _id: MAC, code: "mac_address", name: "MAC-адрес" },
    ]),
  );
  // У «Маршрутизатора» связана только ОС
  t.mock.method(DeviceTypeAttribute, "find", () => chain([{ attributeId: OS, order: 0 }]));
  const links = [];
  // Связка — upsert по паре тип+атрибут
  t.mock.method(DeviceTypeAttribute, "updateOne", async (filter) => {
    links.push(filter);
    return { upsertedCount: 1 };
  });
  let saved;
  t.mock.method(ClientDevice.prototype, "save", async function save() {
    saved = this;
    return this;
  });

  const res = { status: () => res, json: () => res };
  let failed;
  await createInventoryCard({ params: { recordId: REC }, userId: undefined }, res, (e) => {
    failed = e;
  });

  assert.ifError(failed);
  assert.deepEqual(
    saved.attributes.map((v) => [String(v.attributeId), v.value]),
    [
      [OS, "RouterOS 7.21.3 (stable)"],
      [IP, "10.0.0.1"],
    ],
  );
  assert.deepEqual(
    links.map((l) => [String(l.deviceTypeId), String(l.attributeId)]),
    [[ROUTER, IP]],
  );
  assert.equal(saved.get("ipAddress"), undefined);
});
