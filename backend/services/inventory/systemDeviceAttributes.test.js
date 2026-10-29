// node --test services/inventory/systemDeviceAttributes.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const mongoose = require("mongoose");
// Базы нет: забытая подмена падает сразу, а не висит в буфере
mongoose.set("bufferCommands", false);

const DeviceTypeAttribute = require("../../models/inventory/deviceTypeAttribute");
const {
  SYSTEM_CODES,
  applySystemValues,
  ensureSystemAttributes,
  systemAttributeChangeError,
  systemIds,
  systemValues,
  withSystemValues,
} = require("./systemDeviceAttributes");

// Стор в памяти вместо Mongo: атрибуты и число значений в конфигурациях.
const memoryStore = ({ attributes = [], configValues = {} } = {}) => {
  let next = 1;
  const db = { attributes: structuredClone(attributes), created: [], flipped: [], updated: [] };
  return {
    db,
    findAttributes: async ({ codes, names }) =>
      db.attributes.filter((a) => codes.includes(a.code) || names.includes(a.name)),
    createAttribute: async (doc) => {
      const created = { _id: `new${next++}`, ...doc };
      db.attributes.push(created);
      db.created.push(created);
      return created;
    },
    updateAttribute: async (id, set) => {
      const attr = db.attributes.find((a) => a._id === id);
      Object.assign(attr, set);
      if (set.scope) db.flipped.push(id);
      db.updated.push([id, set]);
    },
    countConfigValues: async (id) => configValues[id] ?? 0,
  };
};

const OS = { _id: "os1", code: "operatingsystem", name: "Операционная система", valueType: "string", scope: "model" };

test("ensureSystemAttributes: создаёт IP и MAC, подхватывает ОС и переводит её на устройство", async () => {
  const store = memoryStore({ attributes: [OS] });
  const ids = await ensureSystemAttributes({ store, log: () => {} });
  assert.equal(ids.os, "os1");
  assert.deepEqual(store.db.flipped, ["os1"]);
  assert.deepEqual(
    store.db.created.map((a) => [a.code, a.name, a.valueType, a.scope]),
    [
      ["ip_address", "IP-адрес", "string", "device"],
      ["mac_address", "MAC-адрес", "string", "device"],
    ],
  );
  assert.equal(ids.ip, store.db.created[0]._id);
  assert.equal(ids.mac, store.db.created[1]._id);

  // Повтор ничего не создаёт и не переключает
  const again = await ensureSystemAttributes({ store, log: () => {} });
  assert.deepEqual(again, ids);
  assert.equal(store.db.created.length, 2);
  assert.deepEqual(store.db.flipped, ["os1"]);
});

test("ensureSystemAttributes: атрибут находится и по имени, если код другой", async () => {
  const store = memoryStore({
    attributes: [{ _id: "ip9", code: "ip", name: "IP-адрес", valueType: "string", scope: "device" }],
  });
  const ids = await ensureSystemAttributes({ store, log: () => {} });
  assert.equal(ids.ip, "ip9");
  assert.deepEqual(
    store.db.created.map((a) => a.code),
    [SYSTEM_CODES.os, SYSTEM_CODES.mac],
  );
});

test("ensureSystemAttributes: найденный по имени получает канонический код, список — строку", async () => {
  const store = memoryStore({
    attributes: [{ _id: "os2", code: "os", name: "Операционная система", valueType: "select", scope: "device", options: [] }],
  });
  const ids = await ensureSystemAttributes({ store, log: () => {} });
  assert.equal(ids.os, "os2");
  assert.deepEqual(store.db.updated, [["os2", { code: "operatingsystem", valueType: "string" }]]);
  // Повтор ничего не пишет
  await ensureSystemAttributes({ store, log: () => {} });
  assert.equal(store.db.updated.length, 1);
});

test("ensureSystemAttributes: системный атрибут числом — перенос остановлен", async () => {
  const store = memoryStore({ attributes: [{ ...OS, valueType: "number" }] });
  await assert.rejects(ensureSystemAttributes({ store, log: () => {} }), {
    message: "У атрибута «Операционная система» вид значений «number», нужен текст — перенос остановлен",
  });
  assert.deepEqual(store.db.updated, []);
});

test("systemAttributeChangeError: системный атрибут не меняет уровень, код, вид и не удаляется", () => {
  const ip = { code: "ip_address", name: "IP-адрес", valueType: "string", scope: "device" };
  assert.equal(
    systemAttributeChangeError(ip, { scope: "model" }),
    "«IP-адрес» — системный атрибут: значение всегда задаётся у каждого устройства",
  );
  assert.equal(systemAttributeChangeError(ip, { code: "ip" }), "«IP-адрес» — системный атрибут: код не меняется");
  assert.equal(
    systemAttributeChangeError(ip, { valueType: "select" }),
    "«IP-адрес» — системный атрибут: вид значений не меняется",
  );
  assert.equal(systemAttributeChangeError(ip, null), "«IP-адрес» — системный атрибут: удалить нельзя");
  // То же значение и несистемный атрибут — без отказа
  assert.equal(systemAttributeChangeError(ip, { scope: "device", code: "ip_address", valueType: "string", name: "IP" }), null);
  assert.equal(systemAttributeChangeError({ code: "ram_gb", name: "ОЗУ" }, null), null);
});

test("systemIds: найденное кэшируется на минуту", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  let calls = 0;
  const all = [
    { _id: "a", code: "operatingsystem", name: "Операционная система" },
    { _id: "b", code: "ip_address", name: "IP-адрес" },
    { _id: "c", code: "mac_address", name: "MAC-адрес" },
  ];
  const store = { findAttributes: async () => (calls++, all) };
  const first = await systemIds({ store, fresh: true });
  assert.deepEqual(first, { os: "a", ip: "b", mac: "c" });
  await systemIds({ store });
  assert.equal(calls, 1);
  t.mock.timers.tick(61_000);
  await systemIds({ store });
  assert.equal(calls, 2);
});

test("ensureSystemAttributes: ОС со значениями в конфигурациях — перенос остановлен", async () => {
  const store = memoryStore({ attributes: [OS], configValues: { os1: 2 } });
  await assert.rejects(ensureSystemAttributes({ store, log: () => {} }), {
    message: "Атрибут «Операционная система» заполнен в конфигурациях — перенос остановлен",
  });
  assert.deepEqual(store.db.flipped, []);
  assert.deepEqual(store.db.created, []);
});

const ids = { os: "os1", ip: "ip1", mac: "mac1" };

test("withSystemValues: меняет только системные, чужие значения не трогает", () => {
  const device = {
    attributes: [
      { attributeId: "made1", value: "2026-06-18" },
      { attributeId: "ip1", value: "10.0.0.1" },
    ],
  };
  const out = withSystemValues(device, { ipAddress: "10.0.0.2", operatingSystem: "RouterOS 7.21.3 (stable)" }, ids);
  assert.deepEqual(
    out.map((v) => [String(v.attributeId), v.value]),
    [
      ["made1", "2026-06-18"],
      ["ip1", "10.0.0.2"],
      ["os1", "RouterOS 7.21.3 (stable)"],
    ],
  );
  // Исходный документ не изменён
  assert.equal(device.attributes[1].value, "10.0.0.1");
  // Пустое значение снимает, неупомянутое (MAC) не трогается
  const cleared = withSystemValues({ attributes: out }, { ipAddress: "" }, ids);
  assert.deepEqual(
    cleared.map((v) => String(v.attributeId)),
    ["made1", "os1"],
  );
});

test("systemValues: значения по id, пустые — null", () => {
  const device = {
    attributes: [
      { attributeId: { _id: "ip1", name: "IP-адрес" }, value: "10.0.0.1" },
      { attributeId: "os1", value: "" },
    ],
  };
  assert.deepEqual(systemValues(device, ids), {
    ipAddress: "10.0.0.1",
    macAddress: null,
    operatingSystem: null,
  });
  assert.deepEqual(systemValues({}, ids), { ipAddress: null, macAddress: null, operatingSystem: null });
});

test("applySystemValues: IP типу без связки — связка создаётся, ОС не тронута", async (t) => {
  const created = [];
  t.mock.method(DeviceTypeAttribute, "find", () => {
    const q = { select: () => q, lean: async () => [{ attributeId: "os1", order: 3 }] };
    return q;
  });
  // Связка — upsert по паре тип+атрибут: параллельная синхронизация не плодит дублей
  t.mock.method(DeviceTypeAttribute, "updateOne", async (filter, update, options) => {
    created.push({ ...filter, ...update.$setOnInsert, upsert: options?.upsert });
    return { upsertedCount: 1 };
  });
  const device = { attributes: [{ attributeId: "os1", value: "RouterOS 7.20" }] };
  await applySystemValues(device, { ipAddress: "10.0.0.7" }, { typeId: "type1", ids });
  assert.deepEqual(
    created.map((doc) => [doc.deviceTypeId, String(doc.attributeId), doc.order, doc.upsert]),
    [["type1", "ip1", 4, true]],
  );
  assert.deepEqual(
    device.attributes.map((v) => [String(v.attributeId), v.value]),
    [
      ["os1", "RouterOS 7.20"],
      ["ip1", "10.0.0.7"],
    ],
  );
});

test("applySystemValues: пустой патч не ходит в базу и не меняет устройство", async () => {
  const device = { attributes: [{ attributeId: "os1", value: "RouterOS 7.20" }] };
  await applySystemValues(device, {}, { typeId: "type1", ids });
  assert.deepEqual(device.attributes, [{ attributeId: "os1", value: "RouterOS 7.20" }]);
});
