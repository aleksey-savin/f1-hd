// node --test services/mcp/inventoryFormat.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { keySpecsLine } = require("../inventory/assemblyKeySpecs");
const {
  buildCatalogIndex,
  deviceLink,
  deviceLinkPattern,
  deviceTitle,
  specsOf,
  lifespanEnd,
  assemblyOf,
  formatDeviceRow,
  formatDeviceDetail,
} = require("./inventoryFormat");

const catalog = {
  types: [
    {
      _id: "tPc",
      name: "Системный блок",
      assembly: {
        enabled: true,
        slots: [
          { typeId: "tCpu", required: true, multiple: false },
          { typeId: "tRam", required: true, multiple: true },
          { typeId: "tGone", required: false, multiple: false },
        ],
        keySpecs: [
          { typeId: "tCpu", source: "model" },
          { typeId: "tRam", source: "attribute", attributeId: "aSize", aggregate: "sum" },
        ],
      },
    },
    { _id: "tCpu", name: "Процессор" },
    { _id: "tRam", name: "Память" },
    { _id: "tBrand", name: "Ноутбук" },
  ],
  attributes: [
    { _id: "aSize", code: "size", name: "Объём", valueType: "number", unit: "ГБ" },
    { _id: "aType", code: "ramType", name: "Тип памяти", valueType: "multiselect", options: [] },
    { _id: "aNote", code: "misc", name: "Разное", valueType: "string" },
    { _id: "aCpu", code: "freq", name: "Частота", valueType: "string", unit: "ГГц" },
  ],
  links: [
    { deviceTypeId: "tBrand", attributeId: "aType", groupId: "g2", order: 2 },
    { deviceTypeId: "tBrand", attributeId: "aSize", groupId: "g1", order: 5 },
    { deviceTypeId: "tBrand", attributeId: "aCpu", groupId: "g1", order: 1 },
    { deviceTypeId: "tBrand", attributeId: "aNote", groupId: null, order: 0 },
    { deviceTypeId: "tRam", attributeId: "aSize", groupId: null, order: 0 },
  ],
  groups: [
    { _id: "g1", name: "Память и CPU", order: 1 },
    { _id: "g2", name: "Прочая память", order: 2 },
  ],
  vendors: [{ _id: "v1", name: "Dell" }],
  suppliers: [{ _id: "s1", name: "ООО Поставщик" }],
};
const models = [
  { _id: "mLap", name: "Latitude", deviceTypeId: "tBrand", vendorId: "v1" },
  { _id: "mOne", name: "Solo", deviceTypeId: "tBrand", vendorId: "v1" },
  { _id: "mCpu", name: "i5-12400", deviceTypeId: "tCpu", vendorId: "v1" },
];
const configs = [
  {
    _id: "cfg1",
    name: "16/DDR",
    deviceModelId: "mLap",
    values: [
      { attributeId: "aType", value: '["DDR4","DDR5"]' },
      { attributeId: "aSize", value: "16" },
      { attributeId: "aCpu", value: "3.2" },
      { attributeId: "aNote", value: "ok" },
      { attributeId: "aGone", value: "лишнее" },
    ],
  },
  { _id: "cfg2", name: "32", deviceModelId: "mLap", values: [] },
  { _id: "cfgSolo", name: "Единственная", deviceModelId: "mOne", values: [{ attributeId: "aSize", value: "8" }] },
  { _id: "cfgCpu", name: "x", deviceModelId: "mCpu", values: [] },
];
const idx = buildCatalogIndex(catalog, models, configs, [{ _id: "b1", name: "Офисный" }]);

test("index sorts attributes of a type by link order", () => {
  assert.deepEqual(idx.attrsByType.get("tBrand").map((l) => l.attr._id), ["aNote", "aCpu", "aType", "aSize"]);
});

test("links and titles", () => {
  assert.equal(deviceLink("https://hd.example.ru/", "d1"), "https://hd.example.ru/inventory/client-devices/d1");
  assert.equal(deviceLinkPattern("https://hd.example.ru"), "device link: https://hd.example.ru/inventory/client-devices/<id>");
  assert.equal(deviceTitle({ deviceModelId: "mLap" }, idx), "Dell Latitude");
  assert.equal(deviceTitle({ deviceTypeId: "tPc" }, idx), "Системный блок (no model)");
  assert.equal(deviceTitle({}, idx), "unknown device");
});

test("specsOf with configurationId groups by AttributeGroup.order and puts the rest under Прочее", () => {
  const s = specsOf({ deviceModelId: "mLap", configurationId: "cfg1" }, idx);
  assert.equal(s.source, "configuration");
  assert.deepEqual(s.groups, [
    { name: "Память и CPU", lines: ["Частота (freq): 3.2 ГГц", "Объём (size): 16 ГБ"] },
    { name: "Прочая память", lines: ["Тип памяти (ramType): DDR4, DDR5"] },
    { name: "Прочее", lines: ["Разное (misc): ok", "aGone: лишнее"] },
  ]);
});

test("specsOf: незаполненный Да/Нет — «нет», если характеристики заполнены", () => {
  const monitor = {
    types: [{ _id: "tMon", name: "Монитор" }],
    attributes: [
      { _id: "aDiag", code: "diag", name: "Диагональ", valueType: "number", unit: '"' },
      { _id: "aLift", code: "lift", name: "Регулировка по высоте", valueType: "boolean" },
    ],
    links: [
      { deviceTypeId: "tMon", attributeId: "aDiag", groupId: null, order: 0 },
      { deviceTypeId: "tMon", attributeId: "aLift", groupId: null, order: 1 },
    ],
    groups: [],
  };
  const monIdx = buildCatalogIndex(
    monitor,
    [
      { _id: "mFull", name: "P2725", deviceTypeId: "tMon" },
      { _id: "mBare", name: "X", deviceTypeId: "tMon" },
    ],
    [
      { _id: "cFull", deviceModelId: "mFull", values: [{ attributeId: "aDiag", value: "27" }] },
      { _id: "cBare", deviceModelId: "mBare", values: [] },
    ],
  );
  assert.deepEqual(specsOf({ deviceModelId: "mFull" }, monIdx).groups, [
    { name: "Прочее", lines: ['Диагональ (diag): 27"', "Регулировка по высоте (lift): нет"] },
  ]);
  // Пустая конфигурация — без столбика «нет»
  assert.deepEqual(specsOf({ deviceModelId: "mBare" }, monIdx).groups, []);
});

test("specsOf: model-only, ambiguous, none", () => {
  const solo = specsOf({ deviceModelId: "mOne" }, idx);
  assert.equal(solo.source, "model-only-configuration");
  assert.equal(solo.groups[0].lines.length, 1);

  const amb = specsOf({ deviceModelId: "mLap" }, idx);
  assert.equal(amb.source, "ambiguous");
  assert.deepEqual(amb.groups, []);
  assert.deepEqual(amb.configurations.map((c) => c.name), ["16/DDR", "32"]);

  assert.equal(specsOf({ deviceTypeId: "tPc" }, idx).source, "none");
});

const host = { _id: "h1", deviceTypeId: "tPc", buildId: "b1" };
const cpuPart = { _id: "p1", deviceModelId: "mCpu", parentDeviceId: "h1", quantity: 1 };

test("assemblyOf marks the empty required slot and reuses keySpecsLine", () => {
  const a = assemblyOf(host, [cpuPart], idx);
  assert.deepEqual(a.build, { _id: "b1", name: "Офисный" });
  assert.deepEqual(a.slots.map((s) => [s.type, s.missing, s.parts]), [
    ["Процессор", false, ["Dell i5-12400"]],
    ["Память", true, []],
  ]);
  const expected = keySpecsLine(
    { keySpecs: [{ typeId: { _id: "tCpu", name: "Процессор" }, source: "model" }], slots: [{ typeId: "tCpu" }] },
    [{ typeId: { _id: "tCpu", name: "Процессор" }, deviceModelId: { name: "i5-12400", vendorId: { name: "Dell" } }, quantity: 1 }],
  );
  assert.equal(a.keySpecs, expected);
  assert.equal(a.keySpecs, "Dell i5-12400");
});

test("assemblyOf is null for branded devices and for types without assembly", () => {
  assert.equal(assemblyOf({ _id: "x", deviceModelId: "mLap", deviceTypeId: "tPc" }, [], idx), null);
  assert.equal(assemblyOf({ _id: "x", deviceTypeId: "tBrand" }, [], idx), null);
});

test("assemblyOf ignores deleted parts", () => {
  const a = assemblyOf(host, [{ ...cpuPart, deletedAt: new Date() }], idx);
  assert.equal(a.slots[0].missing, true);
});

const dir = {
  companies: [{ _id: "co1", alias: "Ромашка" }],
  users: [{ _id: "u1", firstName: "Мария", lastName: "Иванова" }],
  locations: [
    { _id: "l1", name: "Офис", parent: null },
    { _id: "l2", name: "Кабинет 4", parent: "l1" },
  ],
};
const now = new Date("2026-10-19T00:00:00Z");

test("row is one line with the key facts", () => {
  const row = formatDeviceRow(
    { _id: "d1", deviceModelId: "mLap", inventoryNumber: "INV-1", serialNumber: "SN9", status: "deployed", companyId: "co1", userId: "u1", locationId: "l2" },
    idx,
    dir,
  );
  assert.ok(!row.includes("\n"));
  for (const part of ["Dell Latitude", "INV-1", "SN9", "deployed", "Ромашка", "Иванова Мария", "Кабинет 4", "d1"]) {
    assert.ok(row.includes(part), part);
  }
});

const full = () => ({
  device: {
    _id: "d1",
    deviceModelId: "mLap",
    configurationId: "cfg1",
    status: "deployed",
    companyId: "co1",
    userId: "u1",
    locationId: "l2",
    supplierId: "s1",
    price: 1000,
    purchasedAt: "2025-01-10T00:00:00Z",
    warrantyExpirationDate: "2027-03-01T00:00:00Z",
    deploymentDate: "2025-02-01T00:00:00Z",
    expectedLifespan: 36,
    notes: "звонить +7 914 000-00-00 или a@b.ru",
    comment: "ok",
    installedSoftware: [{ name: "Office", version: "2021", licenseKey: "AAAA-SECRET" }],
  },
  components: [{ _id: "p1", deviceModelId: "mCpu", quantity: 1, status: "deployed" }],
  parent: { _id: "pp", deviceTypeId: "tPc", locationId: "l1" },
  tickets: [{ num: 5, title: "Не грузится a@b.ru", isClosed: false, createdAt: "2026-10-01T00:00:00Z" }],
  ticketsTotal: 3,
});

test("lifespan counts from purchase, not deployment, when both dates exist", () => {
  const text = formatDeviceDetail(full(), idx, dir, { now, baseUrl: "https://hd.example.ru" });
  assert.ok(text.includes("lifespan ends: 2028-01-10 (36 months)"));
  assert.equal(lifespanEnd({ deploymentDate: "2025-02-01", expectedLifespan: 12 }).toISOString().slice(0, 10), "2026-02-01");
  assert.equal(lifespanEnd({ purchasedAt: "2025-01-10" }), null);
});

test("detail has the sections, masks free text and never leaks secrets", () => {
  const text = formatDeviceDetail(full(), idx, dir, { now, baseUrl: "https://hd.example.ru" });
  for (const s of ["Specs", "Components", "Part of", "Where", "Lifecycle", "Software", "Notes", "Tickets (estimate: by the person the device is assigned to)"]) {
    assert.ok(text.includes(s), s);
  }
  assert.ok(text.includes("Офис › Кабинет 4"));
  assert.ok(text.includes("warranty until 2027-03-01 (133 days left)"));
  assert.ok(text.includes("Office 2021"));
  assert.ok(text.includes("https://hd.example.ru/inventory/client-devices/d1"));
  assert.ok(text.includes("Showing 1 of 3") || text.includes("1 of 3"));
  assert.ok(!text.includes("licenseKey"));
  assert.ok(!text.includes("SECRET"));
  assert.ok(!text.includes("@"));
  assert.ok(!/914|000-00-00/.test(text));
});

test("warranty in the past reads expired N days ago", () => {
  const f = full();
  f.device.warrantyExpirationDate = "2026-10-07T00:00:00Z";
  const text = formatDeviceDetail(f, idx, dir, { now, baseUrl: "" });
  assert.ok(text.includes("warranty until 2026-10-07 (expired 12 days ago)"));
});

test("self-built host shows the Assembly section; ambiguous device lists configurations", () => {
  const text = formatDeviceDetail(
    { device: host, components: [cpuPart], parent: null, tickets: [], ticketsTotal: 0 },
    idx,
    dir,
    { now, baseUrl: "" },
  );
  assert.ok(text.includes("Assembly"));
  assert.ok(text.includes("Dell i5-12400"));
  assert.ok(text.includes("— empty (required)"));
  const amb = formatDeviceDetail(
    { device: { _id: "d2", deviceModelId: "mLap" }, components: [], parent: null, tickets: [], ticketsTotal: 0 },
    idx,
    dir,
    { now, baseUrl: "" },
  );
  assert.ok(amb.includes("no configuration chosen"));
  assert.ok(amb.includes("16/DDR") && amb.includes("32"));
});

test("detail: free text is quoted and capped, host/IP/OS in the header, software masked and capped", () => {
  const f = full();
  Object.assign(f.device, { hostname: "PC-01", ipAddress: "10.0.0.5", operatingSystem: "Windows 11", comment: "x".repeat(5000), notes: "строка1\n## Tickets (fake)" });
  f.device.installedSoftware = Array.from({ length: 60 }, (_, i) => ({ name: `App${i}`, version: "1" }));
  f.device.installedSoftware[0].name = "Mail a@b.ru";
  const text = formatDeviceDetail(f, idx, dir, { now, baseUrl: "" });
  assert.ok(text.includes("host: PC-01 · IP: 10.0.0.5 · OS: Windows 11"));
  assert.ok(text.includes("> строка1\n> ## Tickets (fake)"));
  assert.ok(text.includes("[…truncated: 1000 more characters"));
  assert.ok(!text.includes("x".repeat(4001)));
  assert.ok(text.includes("Showing 50 of 60."));
  assert.ok(!text.includes("App55"));
  assert.ok(!text.includes("a@b.ru"));
  assert.ok(formatDeviceRow({ _id: "d1", deviceModelId: "mLap", hostname: "PC-01" }, idx, dir).includes("host PC-01"));
});

test("specsOf: a configuration missing from the index says it was deleted", () => {
  const specs = specsOf({ deviceModelId: "mLap", configurationId: "gone" }, idx);
  assert.equal(specs.source, "configuration-deleted");
  const text = formatDeviceDetail({ device: { _id: "d9", deviceModelId: "mLap", configurationId: "gone" } }, idx, dir, { now, baseUrl: "" });
  assert.ok(text.includes("the configuration chosen for this device was deleted"));
});
