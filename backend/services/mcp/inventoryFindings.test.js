// node --test services/mcp/inventoryFindings.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { FINDING_KINDS, dupKey, isValidValue } = require("./inventoryFindings");
const { buildCatalogIndex } = require("./inventoryFormat");

const now = new Date("2026-10-16T00:00:00Z");
const day = (n) => new Date(now.getTime() + n * 86400000);

const types = [
  { _id: "t-pc", name: "Системный блок", assembly: { enabled: true, slots: [{ typeId: "t-cpu", required: true }, { typeId: "t-ram", required: true, multiple: true }], keySpecs: [] } },
  { _id: "t-cpu", name: "Процессор" },
  { _id: "t-ram", name: "ОЗУ" },
  { _id: "t-mon", name: "Монитор" },
  { _id: "t-mon2", name: "Мoнитор" }, // латинская o
];
const attributes = [
  { _id: "a-num", code: "size", name: "Объём", valueType: "number" },
  { _id: "a-sel", code: "kind", name: "Тип памяти", valueType: "select", options: [{ value: "DDR4" }] },
  { _id: "a-unused", code: "lonely", name: "Одинокий", valueType: "string" },
  { _id: "a-dup", code: "kind2", name: "Tип памяти", valueType: "string" }, // латинская T
];
const links = [
  { deviceTypeId: "t-ram", attributeId: "a-num" },
  { deviceTypeId: "t-ram", attributeId: "a-sel" },
  { deviceTypeId: "t-ram", attributeId: "a-dup" },
  { deviceTypeId: "t-cpu", attributeId: "a-ghost" },
];
const catalog = { types, attributes, links, groups: [], vendors: [{ _id: "v1", name: "Kingston" }, { _id: "v2", name: "Intel" }], suppliers: [] };
const models = [
  { _id: "m-a", name: "Fury 16", deviceTypeId: "t-ram", vendorId: "v1" },
  { _id: "m-b", name: "FURY 16", deviceTypeId: "t-ram", vendorId: "v1" },
  { _id: "m-c", name: "Fury 16", deviceTypeId: "t-ram", vendorId: "v2" },
  { _id: "m-cpu", name: "Core i5", deviceTypeId: "t-cpu", vendorId: "v2" },
];
const configs = [
  { _id: "c-a", name: "16 ГБ", deviceModelId: "m-a", values: [{ attributeId: "a-num", value: "abc" }, { attributeId: "a-sel", value: "DDR5" }, { attributeId: "a-ghost", value: "x" }] },
  { _id: "c-cpu", name: "Базовая", deviceModelId: "m-cpu", values: [{ attributeId: "a-num", value: "4,5" }] },
];
const builds = [
  { _id: "b-bad", name: "Старая", deviceTypeId: "t-pc", parts: [{ typeId: "t-ram", deviceModelId: "m-gone", quantity: 1 }, { typeId: "t-cpu", deviceModelId: "m-cpu", configurationId: "c-gone" }, { typeId: "t-mon", deviceModelId: "m-cpu" }] },
  { _id: "b-ok", name: "Рабочая", deviceTypeId: "t-pc", parts: [{ typeId: "t-cpu", deviceModelId: "m-cpu", configurationId: "c-cpu" }] },
];
const idx = buildCatalogIndex(catalog, models, configs, builds);

const rows = [
  { _id: "w1", deviceModelId: "m-a", status: "deployed", serialNumber: "SN-1", inventoryNumber: "I1", locationId: "l1", warrantyExpirationDate: day(30) },
  { _id: "w2", deviceModelId: "m-a", status: "deployed", serialNumber: "SN-2", locationId: "l1", warrantyExpirationDate: day(-5) },
  { _id: "w3", deviceModelId: "m-a", status: "disposed", serialNumber: "SN-3", locationId: "l1", warrantyExpirationDate: day(-5), nextMaintenanceDate: day(-1) },
  { _id: "l1x", deviceModelId: "m-a", status: "deployed", serialNumber: "SN-4", locationId: "l1", purchasedAt: new Date("2020-01-01"), expectedLifespan: 60 },
  { _id: "mt", deviceModelId: "m-a", status: "deployed", serialNumber: "SN-5", locationId: "l1", nextMaintenanceDate: day(-10) },
  { _id: "rep", deviceModelId: "m-a", status: "inRepair", serialNumber: "SN-6", locationId: "l1", updatedAt: day(-40) },
  { _id: "rep2", deviceModelId: "m-a", status: "inRepair", serialNumber: "SN-7", locationId: "l1", updatedAt: day(-10) },
  { _id: "idle", deviceModelId: "m-a", status: "inReserve", serialNumber: "SN-8", locationId: "l1", updatedAt: day(-100) },
  { _id: "idleC", deviceModelId: "m-cpu", status: "inReserve", serialNumber: "SN-9", locationId: "l1", parentDeviceId: "host", updatedAt: day(-100) },
  { _id: "nodata", deviceModelId: null, deviceTypeId: "t-mon", status: "deployed" },
  { _id: "dup1", deviceModelId: "m-a", status: "deployed", serialNumber: " abc ", locationId: "l1" },
  { _id: "dup2", deviceModelId: "m-a", status: "deployed", serialNumber: "ABC", locationId: "l1" },
  { _id: "host", deviceTypeId: "t-pc", status: "deployed", serialNumber: "SN-H", locationId: "l1", userId: "u1" },
  { _id: "host2", deviceTypeId: "t-pc", status: "deployed", serialNumber: "SN-H2", locationId: "l1" },
];
const components = [
  { _id: "cpu1", parentDeviceId: "host", deviceModelId: "m-cpu" },
  { _id: "ram-dead", parentDeviceId: "host2", deviceModelId: "m-a", deletedAt: day(-1) },
];
const tickets = [
  { _id: "k1", relatedClientDeviceId: "w1", createdAt: day(-5) },
  { _id: "k2", applicantId: "u1", createdAt: day(-6) },
  { _id: "k3", applicantId: "u1", createdAt: day(-300) },
  { _id: "k4", relatedClientDeviceId: "w1", createdAt: day(-7) },
];
const data = { rows, catalogIdx: idx, models, configs, links, builds, components, tickets, systemUserIds: [] };
const run = (kind, opts = {}, d = data) => FINDING_KINDS.find((k) => k.kind === kind).check(d, { now, limit: 20, ...opts });
const ids = (result) => result.items.map((i) => i.id).sort();

test("FINDING_KINDS is a frozen list in the agreed order", () => {
  assert.ok(Object.isFrozen(FINDING_KINDS));
  assert.deepEqual(FINDING_KINDS.map((k) => k.kind), [
    "warrantyExpiring", "warrantyExpired", "lifespanExceeded", "maintenanceOverdue", "longInRepair", "idleStock", "missingData",
    "duplicateSerials", "catalogDuplicates", "unusedAttributes", "modelsWithoutConfiguration", "invalidAttributeValues", "orphanRefs",
    "ticketHeavy", "incompleteAssemblies", "brokenBuilds",
  ]);
});

test("dupKey folds case, yo, Latin look-alikes and punctuation", () => {
  assert.equal(dupKey("Мoнитор "), dupKey("монитор"));
  assert.equal(dupKey("Ёлка-2"), dupKey("елка 2"));
});

test("isValidValue per value type", () => {
  assert.equal(isValidValue({ valueType: "select", options: [{ value: "DDR4" }] }, "DDR5"), false);
  assert.equal(isValidValue({ valueType: "select", options: [{ value: "DDR4" }] }, "DDR4"), true);
  assert.equal(isValidValue({ valueType: "number" }, "4,5"), true);
  assert.equal(isValidValue({ valueType: "number" }, "abc"), false);
  assert.equal(isValidValue({ valueType: "boolean" }, "Да"), true);
  assert.equal(isValidValue({ valueType: "boolean" }, "maybe"), false);
  const multi = { valueType: "multiselect", options: [{ value: "a" }, { value: "b" }] };
  assert.equal(isValidValue(multi, JSON.stringify(["a", "b"])), true);
  assert.equal(isValidValue(multi, JSON.stringify(["a", "z"])), false);
  assert.equal(isValidValue(multi, "a"), true);
  assert.equal(isValidValue({ valueType: "string" }, "anything"), true);
});

test("warrantyExpiring: within days, default 60; days overrides", () => {
  assert.deepEqual(ids(run("warrantyExpiring")), ["w1"]);
  assert.equal(run("warrantyExpiring", { days: 10 }).count, 0);
});

test("warrantyExpired: past warranty, retired excluded", () => {
  assert.deepEqual(ids(run("warrantyExpired")), ["w2"]);
});

test("lifespanExceeded: purchase + months, not retired", () => {
  assert.deepEqual(ids(run("lifespanExceeded")), ["l1x"]);
});

test("maintenanceOverdue: not retired", () => {
  assert.deepEqual(ids(run("maintenanceOverdue")), ["mt"]);
});

test("longInRepair: last edit older than days, approximate note", () => {
  const r = run("longInRepair");
  assert.deepEqual(ids(r), ["rep"]);
  assert.match(r.note, /approximate: by last edit, the status change date is not stored/);
});

test("idleStock: free root devices idle for days (components excluded)", () => {
  assert.deepEqual(ids(run("idleStock")), ["idle"]);
  assert.equal(run("idleStock", { days: 200 }).count, 0);
});

test("retired devices are skipped by missingData and incompleteAssemblies", () => {
  const retired = [{ _id: "r1", deviceTypeId: "t-mon", status: "disposed" }, { _id: "r2", deviceTypeId: "t-pc", status: "decommissioned", serialNumber: "S", locationId: "l" }];
  const d = { ...data, rows: retired, components: [] };
  assert.equal(run("missingData", {}, d).count, 0);
  assert.equal(run("incompleteAssemblies", {}, d).count, 0);
});

test("missingData: says what is missing; self-built needs no model", () => {
  const r = run("missingData");
  assert.deepEqual(ids(r), ["nodata"]);
  assert.match(r.items[0].line, /no serial number, no location, no model/);
  assert.ok(r.items[0].line.endsWith("nodata"));
});

test("duplicateSerials: trimmed, case-insensitive, with note", () => {
  const r = run("duplicateSerials");
  assert.equal(r.count, 1);
  assert.match(r.items[0].line, /dup1/);
  assert.match(r.items[0].line, /dup2/);
  assert.match(r.note, /repeated serials are allowed, check them/);
});

test("catalogDuplicates: types, models within one vendor, attributes", () => {
  const r = run("catalogDuplicates");
  assert.deepEqual(r.items.map((i) => i.kind).sort(), ["attribute", "model", "type"]);
  assert.match(r.items.find((i) => i.kind === "model").line, /Kingston Fury 16/);
  assert.doesNotMatch(r.items.find((i) => i.kind === "model").line, /Intel/);
});

test("unusedAttributes: no link and no value", () => {
  assert.deepEqual(ids(run("unusedAttributes")), ["a-unused"]);
});

test("modelsWithoutConfiguration: names the model", () => {
  const r = run("modelsWithoutConfiguration");
  assert.deepEqual(ids(r), ["m-b", "m-c"]);
  assert.match(r.items.find((i) => i.id === "m-c").line, /Intel Fury 16/);
});

test("invalidAttributeValues: bad number and bad select option", () => {
  const r = run("invalidAttributeValues");
  assert.equal(r.count, 2);
  assert.ok(r.items.some((i) => /Объём/.test(i.line) && /abc/.test(i.line)));
  assert.ok(r.items.some((i) => /Тип памяти/.test(i.line) && /DDR5/.test(i.line)));
});

test("orphanRefs: type link and configuration value to a missing attribute", () => {
  const r = run("orphanRefs");
  assert.equal(r.count, 2);
  assert.ok(r.items.some((i) => i.kind === "type" && /Процессор/.test(i.line)));
  assert.ok(r.items.some((i) => i.kind === "model" && /16 ГБ/.test(i.line)));
});

test("ticketHeavy: devices and models by estimate, window by days, no double count", () => {
  const r = run("ticketHeavy");
  const device = r.items.find((i) => i.kind === "device");
  assert.equal(device.id, "w1"); // k1 + k4 по связи, k2 у host-а: 2 против 1
  assert.match(device.line, /2 tickets/);
  assert.ok(r.items.some((i) => i.kind === "device" && i.id === "host" && /1 ticket\b/.test(i.line)));
  assert.ok(r.items.some((i) => i.kind === "model" && i.id === "m-a"));
  assert.match(r.note, /estimate/);
  const system = run("ticketHeavy", {}, { ...data, systemUserIds: ["u1"] });
  assert.ok(!system.items.some((i) => i.id === "host"));
});

test("incompleteAssemblies: live parts only, names missing slots", () => {
  const r = run("incompleteAssemblies");
  assert.deepEqual(ids(r), ["host", "host2"]);
  assert.match(r.items.find((i) => i.id === "host").line, /missing: ОЗУ/);
  assert.match(r.items.find((i) => i.id === "host2").line, /missing: Процессор, ОЗУ/);
});

test("brokenBuilds: deleted model, deleted configuration, type not in slots", () => {
  const r = run("brokenBuilds");
  assert.deepEqual(ids(r), ["b-bad"]);
  assert.match(r.items[0].line, /Старая/);
  assert.match(r.items[0].line, /model deleted/);
  assert.match(r.items[0].line, /configuration deleted/);
  assert.match(r.items[0].line, /Монитор.*not a slot/);
});

test("limit cuts items but not the count", () => {
  const r = run("invalidAttributeValues", { limit: 1 });
  assert.equal(r.count, 2);
  assert.equal(r.items.length, 1);
});

test("empty fleet: every check answers 0", () => {
  const empty = { rows: [], catalogIdx: buildCatalogIndex({}), models: [], configs: [], links: [], builds: [], components: [], tickets: [], systemUserIds: [] };
  for (const { kind, check } of FINDING_KINDS) {
    const r = check(empty, { now, limit: 20 });
    assert.equal(r.count, 0, kind);
    assert.deepEqual(r.items, [], kind);
  }
});

test("warrantyExpiring: retired devices are excluded", () => {
  const retired = { _id: "wr", deviceModelId: "m-a", status: "decommissioned", warrantyExpirationDate: day(10) };
  assert.deepEqual(ids(run("warrantyExpiring", {}, { ...data, rows: [...rows, retired] })), ["w1"]);
});
