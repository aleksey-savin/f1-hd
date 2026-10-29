// node --test services/inventory/changeOps/names.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
// Базы нет: забытая подмена падает сразу, а не висит в буфере
mongoose.set("bufferCommands", false);

const ClientDevice = require("../../../models/inventory/clientDevice");
const DeviceModel = require("../../../models/inventory/deviceModel");
const DeviceType = require("../../../models/inventory/deviceType");
const Vendor = require("../../../models/inventory/vendor");
const User = require("../../../models/user");
const Company = require("../../../models/company");
const Location = require("../../../models/inventory/location");
const DeviceConfiguration = require("../../../models/inventory/deviceConfiguration");
const { describe, liveParts } = require("./names");

const T1 = new Date("2026-10-01T10:00:00Z");
const DEV = "aaaaaaaaaaaaaaaaaaaaaaa1";
const MODEL = "bbbbbbbbbbbbbbbbbbbbbbb1";
const TYPE = "eeeeeeeeeeeeeeeeeeeeeee1";
const VENDOR = "fffffffffffffffffffffff1";

// findById(id).select(...).lean() по словарю id -> документ
const stubFind = (Model, docs) => {
  const original = Model.findById;
  Model.findById = (id) => ({
    select() {
      return this;
    },
    lean: async () => docs[String(id)] ?? null,
  });
  return () => {
    Model.findById = original;
  };
};

test("describe: устройство — тип и номер, без номера — модель", async (t) => {
  const restore = [
    stubFind(ClientDevice, {
      [DEV]: { _id: DEV, inventoryNumber: "PC-000123", deviceModelId: MODEL, updatedAt: T1 },
      bbbbbbbbbbbbbbbbbbbbbbb9: { deviceModelId: MODEL, updatedAt: T1 },
      ccccccccccccccccccccccc9: { inventoryNumber: "X", deletedAt: T1, updatedAt: T1 },
    }),
    stubFind(DeviceModel, { [MODEL]: { name: "ThinkPad X1", vendorId: VENDOR, deviceTypeId: TYPE } }),
    stubFind(DeviceType, { [TYPE]: { name: "Ноутбук" } }),
    stubFind(Vendor, { [VENDOR]: { name: "Lenovo" } }),
  ];
  t.after(() => restore.forEach((undo) => undo()));

  assert.deepEqual(await describe("ClientDevice", DEV), { name: "Ноутбук PC-000123", updatedAt: T1, hidden: false });
  assert.deepEqual(await describe("ClientDevice", "bbbbbbbbbbbbbbbbbbbbbbb9"), {
    name: "Lenovo ThinkPad X1",
    updatedAt: T1,
    hidden: false,
  });
  // удалённое — найдено, но скрыто (отказ — дело kit)
  assert.deepEqual(await describe("ClientDevice", "ccccccccccccccccccccccc9"), {
    name: "X",
    updatedAt: T1,
    hidden: true,
    deleted: true,
  });
  assert.equal(await describe("ClientDevice", "nope"), null);
  assert.equal(await describe("Unknown", DEV), null);
});

test("describe: пользователь — фамилия и имя", async (t) => {
  t.after(stubFind(User, { [DEV]: { firstName: "Анна", lastName: "Иванова", updatedAt: T1 } }));
  assert.deepEqual(await describe("User", DEV), { name: "Иванова Анна", updatedAt: T1, hidden: false });
});

test("describe: пользователь без имени — не почта", async (t) => {
  t.after(stubFind(User, { [DEV]: { email: "anna@example.ru", updatedAt: T1 } }));
  assert.deepEqual(await describe("User", DEV), { name: "пользователь без имени", updatedAt: T1, hidden: false });
});

test("liveParts: живые детали хоста строками; кривой id — пусто без запроса", async (t) => {
  const original = ClientDevice.find;
  t.after(() => {
    ClientDevice.find = original;
  });
  const asked = [];
  ClientDevice.find = (filter) => {
    asked.push(filter);
    return { select: () => ({ lean: async () => [{ _id: new mongoose.Types.ObjectId(MODEL) }] }) };
  };
  assert.deepEqual(await liveParts(DEV), [MODEL]);
  assert.deepEqual(asked, [{ parentDeviceId: DEV, deletedAt: null }]);
  assert.deepEqual(await liveParts("nope"), []);
  assert.equal(asked.length, 1);
});

test("describe: hidden у isActive:false и deletedAt", async (t) => {
  const restore = [
    stubFind(DeviceType, {
      eeeeeeeeeeeeeeeeeeeeeee2: { name: "Старый", isActive: false, updatedAt: T1 },
      eeeeeeeeeeeeeeeeeeeeeee3: { name: "Живой", isActive: true, updatedAt: T1 },
    }),
    stubFind(DeviceModel, {
      bbbbbbbbbbbbbbbbbbbbbbb2: { name: "Удалена", deletedAt: T1, updatedAt: T1 },
      bbbbbbbbbbbbbbbbbbbbbbb3: { name: "Живая", updatedAt: T1 },
    }),
  ];
  t.after(() => restore.forEach((undo) => undo()));

  assert.equal((await describe("DeviceType", "eeeeeeeeeeeeeeeeeeeeeee2")).hidden, true);
  assert.equal((await describe("DeviceType", "eeeeeeeeeeeeeeeeeeeeeee3")).hidden, false);
  assert.equal((await describe("DeviceModel", "bbbbbbbbbbbbbbbbbbbbbbb2")).hidden, true);
  assert.equal((await describe("DeviceModel", "bbbbbbbbbbbbbbbbbbbbbbb3")).hidden, false);
});

test("describe: isActive:false скрывает только записи справочников", async (t) => {
  const off = (name) => ({ name, isActive: false, updatedAt: T1 });
  const restore = [
    stubFind(Vendor, { [VENDOR]: off("Старый вендор") }),
    stubFind(DeviceType, { [TYPE]: off("Старый тип") }),
    stubFind(Company, { [DEV]: { alias: "Ромашка", isActive: false, updatedAt: T1 } }),
    stubFind(User, { [DEV]: { firstName: "Анна", lastName: "Иванова", isActive: false, updatedAt: T1 } }),
    stubFind(Location, { [DEV]: off("Кабинет 214") }),
  ];
  t.after(() => restore.forEach((undo) => undo()));
  assert.equal((await describe("Vendor", VENDOR)).hidden, true);
  assert.equal((await describe("DeviceType", TYPE)).hidden, true);
  // У компании, пользователя и помещения isActive — не «скрыто из выбора»
  assert.equal((await describe("Company", DEV)).hidden, false);
  assert.equal((await describe("User", DEV)).hidden, false);
  assert.equal((await describe("Location", DEV)).hidden, false);
});

test("describe: безымянная конфигурация — именем модели, не «без названия»", async (t) => {
  const restore = [
    stubFind(DeviceConfiguration, {
      ccccccccccccccccccccccc1: { name: "", deviceModelId: MODEL, updatedAt: T1 },
      ccccccccccccccccccccccc2: { name: "16/512", deviceModelId: MODEL, updatedAt: T1 },
    }),
    stubFind(DeviceModel, { [MODEL]: { name: "ThinkPad X1", vendorId: VENDOR } }),
    stubFind(Vendor, { [VENDOR]: { name: "Lenovo" } }),
  ];
  t.after(() => restore.forEach((undo) => undo()));
  assert.equal((await describe("DeviceConfiguration", "ccccccccccccccccccccccc1")).name, "Lenovo ThinkPad X1");
  assert.equal((await describe("DeviceConfiguration", "ccccccccccccccccccccccc2")).name, "16/512");
});
