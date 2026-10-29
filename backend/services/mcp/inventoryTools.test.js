// node --test services/mcp/inventoryTools.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;

const { createInventoryTools, parseDeviceRef, buildDeviceFilter } = require("./inventoryTools");
const { ticketLinkFilter } = require("./inventorySource");

const types = [
  { _id: "t-pc", name: "Системный блок", isActive: true, assembly: {
    enabled: true,
    slots: [
      { typeId: "t-cpu", required: true, multiple: false },
      { typeId: "t-ram", required: true, multiple: true },
    ],
    keySpecs: [{ typeId: "t-ram", source: "attribute", attributeId: "a-size", aggregate: "sum" }],
  } },
  { _id: "t-ram", name: "ОЗУ", isActive: true, isComponent: true, attachableToTypeIds: ["t-pc"] },
  { _id: "t-cpu", name: "Процессор", isActive: true, isComponent: true, attachableToTypeIds: ["t-pc"] },
  { _id: "t-p1", name: "Принтер лазерный", isActive: true },
  { _id: "t-p2", name: "Принтер струйный", isActive: true },
  { _id: "t-old", name: "Старый тип", isActive: false },
];
const attributes = [
  { _id: "a-size", code: "ram_size", name: "Объём", valueType: "number", unit: "ГБ", isActive: true },
  { _id: "a-type", code: "ram_type", name: "Тип памяти", valueType: "select", options: [{ value: "ddr4", label: "DDR4" }, { value: "ddr5", label: "DDR5" }], isActive: true },
  { _id: "a-sock", code: "cpu_socket", name: "Сокет", valueType: "string", isActive: true },
  { _id: "a-dead", code: "legacy", name: "Устаревший", valueType: "string", isActive: false },
];
const groups = [{ _id: "g2", name: "Общее", order: 2 }, { _id: "g1", name: "Память", order: 1 }];
const links = [
  { deviceTypeId: "t-ram", attributeId: "a-type", groupId: "g2", required: false, order: 1 },
  { deviceTypeId: "t-ram", attributeId: "a-size", groupId: "g1", required: true, order: 2 },
  { deviceTypeId: "t-cpu", attributeId: "a-sock", groupId: null, required: true, order: 1 },
];
const vendors = [{ _id: "v1", name: "Kingston", isActive: true }, { _id: "v2", name: "Intel", isActive: true }, { _id: "v3", name: "Closed", isActive: false }];
const suppliers = [{ _id: "s1", name: "ООО Поставщик", phone: "+7 999 111-22-33", email: "sales@supplier.ru", inn: "2540123456" }];
const catalog = { types, attributes, links, groups, vendors, suppliers };

const models = [
  { _id: "m-ram", name: "Fury 16", deviceTypeId: "t-ram", vendorId: "v1", compatibleWithModelIds: ["m-cpu"] },
  { _id: "m-cpu", name: "Core i5", deviceTypeId: "t-cpu", vendorId: "v2" },
  { _id: "m-hp", name: "LaserJet", deviceTypeId: "t-p1", vendorId: "v2" },
];
const configs = [
  { _id: "c-ram", name: "16 ГБ DDR4", deviceModelId: "m-ram", values: [{ attributeId: "a-size", value: "16" }, { attributeId: "a-type", value: "ddr4" }] },
  { _id: "c-cpu", name: "Базовая", deviceModelId: "m-cpu", values: [{ attributeId: "a-sock", value: "LGA1700" }] },
];
const builds = [
  { _id: "b1", name: "Офисный", deviceTypeId: "t-pc", parts: [
    { typeId: "t-ram", deviceModelId: "m-ram", configurationId: "c-ram", quantity: 2 },
    { typeId: "t-cpu", deviceModelId: "m-cpu", configurationId: null, quantity: 1 },
  ] },
  { _id: "b2", name: "Принтерный", deviceTypeId: "t-p1", parts: [] },
  { _id: "b3", name: "Удалённый", deviceTypeId: "t-pc", parts: [], deletedAt: new Date("2026-01-01") },
];
const devices = [
  { _id: "d1", buildId: "b1", deviceModelId: "m-ram", configurationId: "c-ram" },
  { _id: "d2", buildId: "b1" },
  { _id: "d3", deviceModelId: "m-ram" },
];

const fakeSource = () => ({
  loadCatalog: async () => catalog,
  loadModels: async (filter = {}) => models.filter(sift({ deletedAt: null, ...filter })),
  loadConfigurations: async () => configs,
  loadBuilds: async (filter = {}) => builds.filter(sift({ deletedAt: null, ...filter })),
  deviceRows: async (filter = {}) => devices.filter(sift(filter)),
  countDevicesByModel: async () => new Map([["m-ram", 2]]),
  countDevicesByConfiguration: async () => new Map([["c-ram", 1]]),
});

const caller = { keyId: "k", keyName: "OpenClaw" };
const setup = () => {
  const logs = [];
  const tools = createInventoryTools({ source: fakeSource(), baseUrl: "https://hd.example.ru", log: (level, message, meta) => logs.push({ message, ...meta }) });
  return { tools, logs };
};
const text = (result) => result.content.map((part) => part.text).join("\n");

test("catalog types: component flag, attribute groups in order, assembly slots", async () => {
  const { tools } = setup();

  const result = await tools.catalog({ section: "types" }, caller, {});
  const out = text(result);

  assert.ok(!result.isError);
  assert.match(out, /## ОЗУ\nflags: component; attachable to: Системный блок/);
  // группа «Память» (order 1) раньше «Общее» (order 2); required отмечен
  assert.ok(out.indexOf("- Память") < out.indexOf("- Общее"));
  assert.match(out, /ram_size · Объём · number · ГБ · required/);
  assert.match(out, /ram_type · Тип памяти · select · options\(ddr4, ddr5\)/);
  assert.match(out, /- Прочее\n {2}- cpu_socket · Сокет · string · required/);
  assert.match(out, /Процессор · required\n {2}- ОЗУ · required · multiple/);
  assert.match(out, /ОЗУ · Объём · sum/);
  assert.doesNotMatch(out, /Старый тип/);
});

test("catalog builds: one type only, no deleted builds, parts in slot order", async () => {
  const { tools } = setup();

  const out = text(await tools.catalog({ section: "builds", type: "Системный блок" }, caller, {}));

  assert.match(out, /## Офисный \(Системный блок; 2 devices made from it\)/);
  assert.doesNotMatch(out, /Принтерный|Удалённый/);
  assert.ok(out.indexOf("Процессор:") < out.indexOf("ОЗУ:"));
  assert.match(out, /ОЗУ: Kingston Fury 16, configuration «16 ГБ DDR4» \(Объём \(ram_size\): 16 ГБ.*\) × 2/);
});

test("catalog attributes: matches by name and by code, case-insensitive", async () => {
  const { tools } = setup();

  const byName = text(await tools.catalog({ section: "attributes", query: "СОКЕТ" }, caller, {}));
  const byCode = text(await tools.catalog({ section: "attributes", query: "Cpu_Socket" }, caller, {}));

  for (const out of [byName, byCode]) {
    assert.match(out, /cpu_socket · Сокет · string · used by 1 types, 1 configurations/);
    assert.doesNotMatch(out, /ram_size/);
  }
});

test("catalog suppliers: names only, no contacts or INN", async () => {
  const { tools } = setup();

  const out = text(await tools.catalog({ section: "suppliers" }, caller, {}));

  assert.match(out, /ООО Поставщик/);
  assert.doesNotMatch(out, /999|@|2540123456/);
});

test("catalog suppliers: hidden ones only with includeInactive, marked inactive", async () => {
  const withHidden = { ...catalog, suppliers: [...suppliers, { _id: "s2", name: "Старый поставщик", isActive: false }] };
  const tools = createInventoryTools({ source: { ...fakeSource(), loadCatalog: async () => withHidden }, baseUrl: "https://hd.example.ru", log: () => {} });

  const live = text(await tools.catalog({ section: "suppliers" }, caller, {}));
  const all = text(await tools.catalog({ section: "suppliers", includeInactive: true }, caller, {}));

  assert.match(live, /- ООО Поставщик$/m);
  assert.doesNotMatch(live, /Старый поставщик/);
  assert.match(all, /- Старый поставщик · inactive/);
  assert.match(all, /- ООО Поставщик$/m);
});

test("catalog groups, vendors and unknown section", async () => {
  const { tools } = setup();

  const groupsOut = text(await tools.catalog({ section: "groups" }, caller, {}));
  const vendorsOut = text(await tools.catalog({ section: "vendors", includeInactive: true }, caller, {}));
  const bad = await tools.catalog({ section: "nope" }, caller, {});

  assert.ok(groupsOut.indexOf("Память · used by 1") < groupsOut.indexOf("Общее · used by 1"));
  assert.match(vendorsOut, /- Closed · inactive/);
  assert.doesNotMatch(text(await tools.catalog({ section: "vendors" }, caller, {})), /Closed/);
  assert.equal(bad.isError, true);
  assert.match(text(bad), /Use one of: types, groups/);
});

test("catalog truncation says so and logs one line per call", async () => {
  const { tools, logs } = setup();

  const out = text(await tools.catalog({ section: "types", limit: 2 }, caller, {}));

  assert.match(out, /Showing 2 of 5\. Narrow with query, or raise limit\./);
  assert.equal(logs.filter((l) => l.message === "MCP tool call").length, 1);
});

test("searchModels: type filter returns only those models with config value lines", async () => {
  const { tools } = setup();

  const result = await tools.searchModels({ type: "ОЗУ" }, caller, {});
  const out = text(result);

  assert.ok(!result.isError);
  assert.match(out, /## Kingston Fury 16\nid: m-ram · type: ОЗУ · devices: 2\ncompatible with: Intel Core i5/);
  assert.match(out, /configuration «16 ГБ DDR4» \(1 devices\): Объём \(ram_size\): 16 ГБ; Тип памяти \(ram_type\): DDR4/);
  assert.doesNotMatch(out, /LaserJet|## Intel/);
});

test("searchModels: ambiguous type is an error listing both names", async () => {
  const { tools } = setup();

  const result = await tools.searchModels({ type: "Принтер" }, caller, {});

  assert.equal(result.isError, true);
  assert.match(text(result), /Принтер лазерный; Принтер струйный/);
});

test("catalog builds: ambiguous type is an error listing both options", async () => {
  const { tools } = setup();

  const result = await tools.catalog({ section: "builds", type: "Принтер" }, caller, {});

  assert.equal(result.isError, true);
  assert.match(text(result), /Принтер лазерный; Принтер струйный/);
});

// ─── Устройства ──────────────────────────────────────────────────────────

const companies = [
  { _id: "c1", alias: "Ромашка", fullTitle: "ООО Ромашка" },
  { _id: "c2", alias: "Ромб", fullTitle: "ООО Ромб" },
  { _id: "c3", alias: "Тюльпан", fullTitle: "ООО Тюльпан" },
];
const users = [
  { _id: "u1", firstName: "Иван", lastName: "Петров", position: "Бухгалтер", company: { _id: "c1" } },
  { _id: "u2", firstName: "Пётр", lastName: "Петров", company: { _id: "c2" } },
];
const locations = [
  { _id: "l3", name: "Кабинет 5", type: "room", company: "c2" },
  { _id: "l4", name: "Кабинет 5", type: "room", company: "c1", parent: "l1" },
  { _id: "l1", name: "Офис", type: "building", company: "c1" },
  { _id: "l2", name: "Кабинет 6", type: "room", parent: "l1", company: "c1" },
];
const directory = { companies, users, locations };
const D = (d) => ({ companyId: "c1", status: "readyForDeployment", ...d });
const deviceRows = [
  D({ _id: "h1", deviceTypeId: "t-pc", status: "deployed", userId: "u1", inventoryNumber: "PC-000123", serialNumber: "SN-H1", locationId: "l2", buildId: "b1" }),
  D({ _id: "cpu1", deviceModelId: "m-cpu", parentDeviceId: "h1", status: "deployed", serialNumber: "SN-CPU1" }),
  D({ _id: "ram1", deviceModelId: "m-ram", configurationId: "c-ram", parentDeviceId: "h1", status: "deployed", serialNumber: "SN-RAM1" }),
  D({ _id: "ramDel", deviceModelId: "m-ram", parentDeviceId: "h1", serialNumber: "SN-DELETED", deletedAt: new Date("2026-01-01") }),
  D({ _id: "freeCpu", deviceModelId: "m-cpu", serialNumber: "SN-FREECPU", inventoryNumber: "CPU-1" }),
  D({ _id: "freeRam", deviceModelId: "m-ram", configurationId: "c-ram", status: "inReserve", serialNumber: "SN-FREERAM" }),
  D({ _id: "usedRam", deviceModelId: "m-ram", configurationId: "c-ram", status: "deployed", serialNumber: "SN-USEDRAM" }),
  D({ _id: "printer", deviceModelId: "m-hp", serialNumber: "SN-PRN" }),
  D({ _id: "pcFree", deviceTypeId: "t-pc", serialNumber: "SN-PCFREE", inventoryNumber: "PC-000124" }),
  D({ _id: "other", companyId: "c2", deviceModelId: "m-ram", configurationId: "c-ram", serialNumber: "SN-OTHER" }),
  D({ _id: "65f0c0ffee0000000000abcd", deviceModelId: "m-hp", serialNumber: "SN-HEX" }),
  D({ _id: "dupA", companyId: "c3", deviceModelId: "m-hp", serialNumber: "DUP-1" }),
  D({ _id: "dupB", companyId: "c3", deviceModelId: "m-hp", hostname: "dup-1" }),
];
const tickets = [
  { _id: "tk1", num: 501, title: "Не включается", isClosed: false, createdAt: new Date("2026-09-01"), applicantId: "u1" },
  { _id: "tk2", num: 502, title: "Чужая", isClosed: true, createdAt: new Date("2026-09-02"), applicantId: "u9" },
];

const deviceSource = () => ({
  ...fakeSource(),
  loadDirectory: async () => directory,
  deviceRows: async (filter = {}) => deviceRows.filter(sift({ deletedAt: null, ...filter })),
  findDevices: async (filter, { skip = 0, limit = 50 } = {}) =>
    deviceRows.filter(sift({ deletedAt: null, ...filter })).slice(skip, skip + limit),
  countDevices: async (filter) => deviceRows.filter(sift({ deletedAt: null, ...filter })).length,
  loadDevice: async (id) => deviceRows.find((d) => d._id === id && !d.deletedAt) ?? null,
  // как настоящий источник, но фейк отдаёт и удалённые: карточка обязана их скрыть
  loadComponents: async (hostIds) => deviceRows.filter((d) => hostIds.includes(d.parentDeviceId)),
  loadAssemblyIds: async () => new Set(deviceRows.filter((d) => d.parentDeviceId).map((d) => d.parentDeviceId)),
  loadKeySpecsFor: async (rows) => new Map(rows.filter((r) => r._id === "pcFree").map((r) => [r._id, "32 ГБ"])),
  loadTicketsForDevices: async (devs, options) => {
    const filter = ticketLinkFilter(devs, options);
    return filter ? tickets.filter(sift(filter)).slice(0, options.limit ?? Infinity) : [];
  },
  countTicketsForDevices: async (devs, options) => {
    const filter = ticketLinkFilter(devs, options);
    return filter ? tickets.filter(sift(filter)).length : 0;
  },
});
const devSetup = (source = deviceSource()) => ({
  tools: createInventoryTools({ source, baseUrl: "https://hd.example.ru", log: () => {}, now: () => new Date("2026-10-19T00:00:00Z") }),
});

test("parseDeviceRef: id, link from any host, plain text, foreign path", () => {
  const id = "65f0c0ffee0000000000abcd";
  assert.deepEqual(parseDeviceRef(`https://hd.example.ru/inventory/client-devices/${id}`), { id });
  assert.deepEqual(parseDeviceRef(`  http://localhost:3000/inventory/client-devices/${id}?tab=1 `), { id });
  assert.deepEqual(parseDeviceRef(id), { id });
  assert.deepEqual(parseDeviceRef("PC-000123"), { text: "PC-000123" });
  const foreign = `https://hd.example.ru/tickets/client-devices/${id}`;
  assert.deepEqual(parseDeviceRef(foreign), { text: foreign });
});

test("buildDeviceFilter: type matches both shapes, empty args give an empty filter", () => {
  assert.deepEqual(buildDeviceFilter({}, {}), {});
  const filter = buildDeviceFilter({}, { typeId: "t-ram", modelIdsOfType: ["m-ram"] });
  const match = sift(filter);
  assert.ok(match({ deviceTypeId: "t-ram" }));
  assert.ok(match({ deviceModelId: "m-ram" }));
  assert.ok(!match({ deviceModelId: "m-cpu" }));
});

test("searchDevices free: excludes deployed and child devices", async () => {
  const { tools } = devSetup();

  const out = text(await tools.searchDevices({ free: true }, caller));

  assert.match(out, /^Devices: 8\n/);
  assert.match(out, /device link: https:\/\/hd\.example\.ru\/inventory\/client-devices\/<id>/);
  assert.match(out, /SN-FREECPU/);
  assert.match(out, /SN-FREERAM/);
  assert.doesNotMatch(out, /SN-H1|SN-CPU1|SN-RAM1|SN-USEDRAM|SN-DELETED/);
});

test("searchDevices: ambiguous company filter is an error listing both", async () => {
  const { tools } = devSetup();

  const result = await tools.searchDevices({ company: "Ром" }, caller);

  assert.equal(result.isError, true);
  assert.match(text(result), /Ромашка; Ромб|Ромб; Ромашка/);
});

test("searchDevices: company, type (both shapes), query by model name and serial", async () => {
  const { tools } = devSetup();

  const byCompany = text(await tools.searchDevices({ company: "Ромб" }, caller));
  assert.match(byCompany, /^Devices: 1\n/);
  assert.match(byCompany, /SN-OTHER/);

  const byType = text(await tools.searchDevices({ type: "Системный блок" }, caller));
  assert.match(byType, /^Devices: 2\n/);

  const byModel = text(await tools.searchDevices({ query: "fury", company: "Ромашка" }, caller));
  assert.match(byModel, /SN-FREERAM/);
  assert.doesNotMatch(byModel, /SN-OTHER|SN-FREECPU/);

  const bySerial = text(await tools.searchDevices({ query: "sn-pcfree" }, caller));
  assert.match(bySerial, /^Devices: 1\n/);
});

test("searchDevices: location includes nested places; truncation line", async () => {
  const { tools } = devSetup();

  const byPlace = text(await tools.searchDevices({ location: "Офис" }, caller));
  assert.match(byPlace, /^Devices: 1\n/);

  const page = text(await tools.searchDevices({ limit: 5 }, caller));
  assert.match(page, /Showing 5 of 12\. Narrow with company, type or status, or ask for page 2\./);
});

test("searchDevices: self-built assembled PC row carries its key line", async () => {
  const { tools } = devSetup();

  const out = text(await tools.searchDevices({ query: "SN-PCFREE" }, caller));

  assert.match(out, /Системный блок \(no model\).*id: pcFree · 32 ГБ/);
});

test("searchDevices: bad status and bad date are errors with a hint", async () => {
  const { tools } = devSetup();

  assert.match(text(await tools.searchDevices({ status: "lost" }, caller)), /Use one of: .*free/);
  assert.match(text(await tools.searchDevices({ warrantyBefore: "2026-02-31" }, caller)), /YYYY-MM-DD/);
});

test("getDevice by inventory number: type-only PC with model-based RAM, deleted part hidden", async () => {
  const { tools } = devSetup();

  const out = text(await tools.getDevice({ device: "PC-000123" }, caller, {}));

  assert.match(out, /# Системный блок \(no model\)/);
  assert.match(out, /Kingston Fury 16 \(ОЗУ\)/);
  assert.match(out, /Объём \(ram_size\): 16 ГБ/);
  assert.match(out, /Intel Core i5 \(Процессор\)/);
  assert.doesNotMatch(out, /SN-DELETED/);
  assert.doesNotMatch(out, /unknown type/);
});

test("getDevice by link and by id; tickets are an estimate by the assigned person", async () => {
  const { tools } = devSetup();

  const hex = "65f0c0ffee0000000000abcd";
  const byLink = text(await tools.getDevice({ device: `https://other.host/inventory/client-devices/${hex}` }, caller, {}));
  const byId = text(await tools.getDevice({ device: hex }, caller, {}));
  assert.match(byLink, /# Intel LaserJet/);
  assert.equal(byLink, byId);

  const out = text(await tools.getDevice({ device: "SN-H1" }, caller, {}));
  assert.match(out, /## Tickets \(estimate: by the person the device is assigned to\)/);
  assert.match(out, /#501 · Не включается/);
  assert.doesNotMatch(out, /#502/);
});

test("getDevice: service accounts do not pull in tickets", async () => {
  const { tools } = devSetup();

  const out = text(await tools.getDevice({ device: "SN-H1" }, caller, { systemAccounts: { unidentifiedId: "u1", robotIds: [] } }));

  assert.doesNotMatch(out, /#501/);
});

test("getDevice: unknown value points to search_devices; several matches are listed", async () => {
  const { tools } = devSetup();

  const missing = await tools.getDevice({ device: "nope" }, caller, {});
  assert.equal(missing.isError, true);
  assert.match(text(missing), /search_devices/);

  const several = await tools.getDevice({ device: "dup-1" }, caller, {});
  assert.equal(several.isError, true);
  assert.match(text(several), /id: dupA/);
  assert.match(text(several), /id: dupB/);
});

test("listAttachable: hides deployed RAM by default, marks it with onlyFree false", async () => {
  const { tools } = devSetup();

  const free = text(await tools.listAttachable({ host: "PC-000123" }, caller));
  assert.match(free, /SN-FREERAM/);
  assert.doesNotMatch(free, /SN-USEDRAM|SN-OTHER|SN-PRN/);

  const all = text(await tools.listAttachable({ host: "PC-000123", onlyFree: false }, caller));
  assert.match(all, /SN-USEDRAM.*\(in use: deployed\)/);
  assert.doesNotMatch(all, /SN-FREERAM.*\(in use/);
});

test("listAttachable: header lists installed parts with specs, live only", async () => {
  const { tools } = devSetup();

  const out = text(await tools.listAttachable({ host: "PC-000123" }, caller));

  assert.match(out, /Installed now:\n- Intel Core i5 \(Процессор\)/);
  assert.match(out, /- Kingston Fury 16 \(ОЗУ\): .*Объём \(ram_size\): 16 ГБ/);
  assert.doesNotMatch(out, /SN-DELETED/);
});

test("listAttachable: a type whose attachableToTypeIds excludes the host type is dropped", async () => {
  const restricted = types.map((t) => (t._id === "t-ram" ? { ...t, attachableToTypeIds: ["t-other"] } : t));
  const source = { ...deviceSource(), loadCatalog: async () => ({ ...catalog, types: restricted }) };
  const { tools } = devSetup(source);

  const out = text(await tools.listAttachable({ host: "PC-000123" }, caller));

  assert.match(out, /SN-FREECPU/);
  assert.doesNotMatch(out, /SN-FREERAM/);
});

test("listAttachable: self-built host groups by slots, taken non-multiple slot is marked", async () => {
  const { tools } = devSetup();

  const out = text(await tools.listAttachable({ host: "PC-000123" }, caller));

  assert.match(out, /## Процессор \(slot taken — detach the current part first\)\n- .*SN-FREECPU/);
  assert.match(out, /## ОЗУ\n- .*SN-FREERAM/);
  assert.ok(out.indexOf("## Процессор") < out.indexOf("## ОЗУ"));
});

test("listAttachable: parts outside the slots go last; compatibility is flagged", async () => {
  const typesPlus = [...types, { _id: "t-ssd", name: "SSD", isActive: true, isComponent: true, attachableToTypeIds: ["t-pc"] }];
  const source = {
    ...deviceSource(),
    loadCatalog: async () => ({ ...catalog, types: typesPlus }),
    findDevices: async (filter, o = {}) =>
      [...deviceRows, D({ _id: "ssd", deviceTypeId: "t-ssd", serialNumber: "SN-SSD" })]
        .filter(sift({ deletedAt: null, ...filter }))
        .slice(0, o.limit ?? 50),
  };
  const { tools } = devSetup(source);

  const out = text(await tools.listAttachable({ host: "PC-000124" }, caller));

  assert.match(out, /## Not in the build's slots\n- .*SN-SSD/);
  assert.ok(out.indexOf("## Процессор") < out.indexOf("## Not in the build's slots"));
  assert.doesNotMatch(out, /slot taken/);
});

test("listAttachable: unknown host and ambiguous type are errors with a hint", async () => {
  const { tools } = devSetup();

  const missing = await tools.listAttachable({ host: "nope" }, caller);
  assert.equal(missing.isError, true);
  assert.match(text(missing), /search_devices/);

  const result = await tools.listAttachable({ host: "PC-000123", type: "О" }, caller);
  assert.equal(result.isError, true);
  assert.match(text(result), /Several component types match/);
  assert.match(text(result), /ОЗУ/);
  assert.match(text(result), /Процессор/);
});

test("listAttachable: flags a candidate compatible with the host's model", async () => {
  const open = types.map((t) => (t._id === "t-cpu" ? { ...t, attachableToTypeIds: [] } : t));
  const { tools } = devSetup({ ...deviceSource(), loadCatalog: async () => ({ ...catalog, types: open }) });

  const out = text(await tools.listAttachable({ host: "SN-FREERAM" }, caller));

  assert.match(out, /SN-FREECPU[\s\S]*compatible with this host's model: yes/);
});

test("searchDevices: place in two companies is ambiguous, options show company, company narrows it", async () => {
  const { tools } = devSetup();

  const both = await tools.searchDevices({ location: "Кабинет 5" }, caller);
  assert.equal(both.isError, true);
  assert.match(text(both), /Several locations match/);
  assert.match(text(both), /Кабинет 5 \(Ромб\)/);
  assert.match(text(both), /Офис › Кабинет 5 \(Ромашка\)/);
  assert.match(text(both), /add company to narrow/);

  const narrowed = await tools.searchDevices({ location: "Кабинет 5", company: "Ромб" }, caller);
  assert.ok(!narrowed.isError);
});

test("searchDevices: people options show the company, company narrows the choice", async () => {
  const { tools } = devSetup();

  const both = await tools.searchDevices({ user: "Петров" }, caller);
  assert.equal(both.isError, true);
  assert.match(text(both), /Several people match/);
  assert.match(text(both), /Петров Иван \(Ромашка\)|Петров Пётр \(Ромб\)/);

  const one = await tools.searchDevices({ user: "Петров", company: "Ромашка" }, caller);
  assert.ok(!one.isError);
  assert.match(text(one), /SN-H1/);
});

test("searchDevices type filter: a model-based device is matched by its model's type only", async () => {
  const match = sift(buildDeviceFilter({}, { typeId: "t-ram", modelIdsOfType: ["m-ram"] }));
  assert.ok(!match({ deviceModelId: "m-cpu", deviceTypeId: "t-ram" }));
  assert.ok(match({ deviceModelId: null, deviceTypeId: "t-ram" }));
  assert.ok(match({ deviceTypeId: "t-ram" }));
});

test("getDevice: only the newest 5 tickets are listed, the total is counted", async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ _id: `m${i}`, num: 600 + i, title: `T${i}`, isClosed: false, createdAt: new Date(2026, 8, i + 1), applicantId: "u1" }));
  tickets.push(...many);
  try {
    const { tools } = devSetup();
    const out = text(await tools.getDevice({ device: "SN-H1" }, caller, {}));
    assert.match(out, /Showing 5 of 9\./);
    assert.equal((out.match(/^- #\d+ /gm) || []).length, 5);
  } finally {
    tickets.length -= many.length;
  }
});

test("getDevice: a 24-hex value that is no id falls back to inventory number / serial", async () => {
  const hex = "aaaaaaaaaaaaaaaaaaaaaaaa";
  deviceRows.push(D({ _id: "zz", deviceModelId: "m-hp", serialNumber: hex }));
  try {
    const { tools } = devSetup();
    assert.match(text(await tools.getDevice({ device: hex }, caller, {})), /# Intel LaserJet/);
    const link = await tools.getDevice({ device: `https://x.y/inventory/client-devices/${"b".repeat(24)}` }, caller, {});
    assert.equal(link.isError, true);
  } finally {
    deviceRows.pop();
  }
});

test("stats: by type over root devices, module-level counts, empty fleet and filters", async () => {
  const { tools } = devSetup();

  const out = text(await tools.stats({}, caller));
  assert.match(out, /^Devices: 10, grouped by type \(root devices only\)\./);
  assert.match(out, /\| Процессор \| 1 \| 1 \| 0 \| 0 \| 0 \|/);

  const none = text(await tools.stats({ status: "disposed" }, caller));
  assert.match(none, /No devices match\./);

  const bad = await tools.stats({ groupBy: "colour" }, caller);
  assert.equal(bad.isError, true);
  assert.match(text(bad), /status, type, model, vendor, company, location/);

  const ambiguous = await tools.stats({ company: "Ром" }, caller);
  assert.equal(ambiguous.isError, true);

  const byCompany = text(await tools.stats({ groupBy: "company", company: "Ромб" }, caller));
  assert.match(byCompany, /\| Ромб \| 1 \|/);
});

test("stats: vendor grouping puts type-only devices under (no model); location missing is (none)", async () => {
  const { tools } = devSetup();

  const byVendor = text(await tools.stats({ groupBy: "vendor" }, caller));
  assert.match(byVendor, /\| \(no model\) \| 2 \|/);
  assert.match(byVendor, /\| Kingston \| /);

  const byLocation = text(await tools.stats({ groupBy: "location" }, caller));
  assert.match(byLocation, /\| \(none\) \| /);
  assert.match(byLocation, /\| Кабинет 6 \| 1 \|/);

  const withComponents = text(await tools.stats({ groupBy: "status", rootOnly: false }, caller));
  assert.match(withComponents, /Devices: 12/);
  assert.doesNotMatch(withComponents, /root devices only/);
});

test("stats: same-named locations of different companies stay two rows; header echoes the filters", async () => {
  const { tools } = devSetup();
  deviceRows.push(D({ _id: "k5a", companyId: "c1", locationId: "l4", deviceModelId: "m-hp", serialNumber: "SN-K5A" }));
  deviceRows.push(D({ _id: "k5b", companyId: "c2", locationId: "l3", deviceModelId: "m-hp", serialNumber: "SN-K5B" }));
  try {
    const out = text(await tools.stats({ groupBy: "location" }, caller));
    assert.match(out, /\| Кабинет 5 \(Ромашка\) \| 1 \|/);
    assert.match(out, /\| Кабинет 5 \(Ромб\) \| 1 \|/);

    const scoped = text(await tools.stats({ company: "Ромб", type: "Принтер лазерный", status: "readyForDeployment" }, caller));
    assert.match(scoped, /^Devices: 1, grouped by type \(company: Ромб, type: Принтер лазерный, status: readyForDeployment, root devices only\)\./);
  } finally {
    deviceRows.length -= 2;
  }
});

test("findings: summary lists every kind with its count, in order", async () => {
  const { tools } = devSetup();

  const out = text(await tools.findings({ kind: "summary" }, caller, {}));

  const names = out.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.match(/^- (\w+)(?: \([^)]*\))?: (\d+)/)?.[1]);
  assert.equal(names.length, 16);
  assert.equal(names[0], "warrantyExpiring");
  assert.equal(names[15], "brokenBuilds");
  assert.match(out, /- warrantyExpiring \(next 60 days\): 0/);
  assert.match(out, /- ticketHeavy \(last 180 days\): /);
  assert.match(out, /- duplicateSerials: 0 \(repeated serials are allowed, check them\)/);
  assert.match(out, /- incompleteAssemblies: 1$/m);
});

test("findings: one kind lists named items with ids at the end and says when cut", async () => {
  const { tools } = devSetup();

  const out = text(await tools.findings({ kind: "missingData", limit: 2 }, caller, {}));

  assert.match(out, /^missingData: \d+ found\./);
  assert.match(out, /Showing 2 of \d+\. Narrow with company, or raise limit\./);
  assert.match(out, /^- .* · [\w]+$/m);
});

test("findings: unknown kind and ambiguous company are tool errors with a next step", async () => {
  const { tools } = devSetup();

  const bad = await tools.findings({ kind: "colour" }, caller, {});
  assert.equal(bad.isError, true);
  assert.match(text(bad), /Use one of: summary, warrantyExpiring/);

  const ambiguous = await tools.findings({ kind: "summary", company: "Ром" }, caller, {});
  assert.equal(ambiguous.isError, true);
  assert.match(text(ambiguous), /Several companies match/);
});

test("findings: ticketHeavy says estimate and never counts service accounts", async () => {
  const { tools } = devSetup();

  const out = text(await tools.findings({ kind: "ticketHeavy", days: 3650 }, caller, { systemAccounts: { unidentifiedId: "u1", robotIds: [] } }));
  assert.equal(out, "ticketHeavy: 0. Nothing found.");

  const real = text(await tools.findings({ kind: "ticketHeavy", days: 3650 }, caller, {}));
  assert.match(real, /estimate/);
  assert.match(real, /PC-000123/);
});

test("findings: empty fleet answers 0 for every kind, never a crash", async () => {
  const { tools } = devSetup({ ...deviceSource(), deviceRows: async () => [] });

  const out = text(await tools.findings({}, caller, {}));

  const counts = out.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.match(/^- \w+(?: \([^)]*\))?: (\d+|top list)/)?.[1]);
  assert.equal(counts.length, 16);
  assert.ok(counts.every((n) => n !== undefined));
  assert.equal(text(await tools.findings({ kind: "idleStock" }, caller, {})), "idleStock: 0. Nothing found.");
});

test("findings: with company the summary separates scoped and catalog-wide kinds and echoes the resolved label", async () => {
  const { tools } = devSetup();

  const out = text(await tools.findings({ kind: "summary", company: "ромб" }, caller, {}));
  assert.match(out, /^Devices of Ромб:\n- warrantyExpiring/m);
  assert.match(out, /^Catalog \(whole helpdesk, the company filter does not apply\):\n- catalogDuplicates/m);
  assert.doesNotMatch(out, /ромб/);

  const one = text(await tools.findings({ kind: "unusedAttributes", company: "Ромб" }, caller, {}));
  assert.match(one, /The company filter does not apply to catalog findings\./);
  const scoped = text(await tools.findings({ kind: "missingData", company: "Ромб" }, caller, {}));
  assert.doesNotMatch(scoped, /does not apply/);
});

test("findings: summary with days 365 loads tickets for 365 days, not 180", async () => {
  const seen = [];
  const base = deviceSource();
  const { tools } = devSetup({ ...base, loadTicketsForDevices: async (devs, options) => (seen.push(options.from), base.loadTicketsForDevices(devs, options)) });

  await tools.findings({ kind: "summary", days: 365 }, caller, {});

  assert.equal(seen.length, 1);
  assert.equal(Math.round((new Date("2026-10-19T00:00:00Z") - seen[0]) / 86400000), 365);
});

test("findings: ticketHeavy prints no misleading count in the summary or the single answer", async () => {
  const { tools } = devSetup();

  const summary = text(await tools.findings({ kind: "summary" }, caller, {}));
  assert.match(summary, /- ticketHeavy \(last 180 days\): top list — ask for this kind/);

  const one = text(await tools.findings({ kind: "ticketHeavy", days: 3650 }, caller, {}));
  assert.match(one, /^Top devices and models by tickets \(estimate/);
  assert.doesNotMatch(one, /found/);
});

test("searchDevices survives a failing key-specs loader", async () => {
  const { tools } = devSetup({ ...deviceSource(), loadKeySpecsFor: async () => { throw new Error("boom"); } });

  const result = await tools.searchDevices({ query: "PC-000124" }, caller);

  assert.notEqual(result.isError, true);
  assert.match(text(result), /PC-000124/);
});

test("hints name get_inventory_catalog, not a bare catalog", async () => {
  const { tools } = devSetup();

  const out = text(await tools.searchModels({ query: "несуществующая-модель-xyz" }, caller));

  assert.match(out, /get_inventory_catalog/);
});

test("listAttachable: a host with neither type nor model says restrictions are not applied", async () => {
  deviceRows.push(D({ _id: "bare", inventoryNumber: "BARE-1", serialNumber: "SN-BARE" }));
  try {
    const { tools } = devSetup();
    const out = text(await tools.listAttachable({ host: "BARE-1" }, caller));
    assert.match(out, /The host has no type or model, so type restrictions are not applied; fix the device record first\./);
  } finally {
    deviceRows.pop();
  }
});
