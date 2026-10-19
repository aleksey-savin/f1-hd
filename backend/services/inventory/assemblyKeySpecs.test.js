// node --test services/inventory/assemblyKeySpecs.test.js
// Векторы совпадают с frontend/src/components/app/assembly-specs.test.js —
// серверный порт обязан давать тот же результат.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildKeySpecs,
  keySpecsLine,
  liveAssembly,
  partTitle,
  formatSpecValue,
  loadKeySpecs,
} = require("./assemblyKeySpecs");

const T = (id, name) => ({ _id: id, name });
const cpu = T("t-cpu", "Процессор");
const ram = T("t-ram", "Оперативная память");
const ssd = T("t-ssd", "Накопитель");
const fan = T("t-fan", "Кулер");

const num = (id, name, unit) => ({ _id: id, name, unit, valueType: "number" });
const txt = (id, name) => ({ _id: id, name, valueType: "text" });
const aSize = num("a-size", "Объём модуля", "ГБ");
const aType = txt("a-type", "Тип памяти");
const dSize = num("d-size", "Объём накопителя", "ГБ");
const dType = txt("d-type", "Тип накопителя");

const model = (id, vendor, name, extra = {}) => ({
  _id: id,
  name,
  vendorId: { _id: `v-${vendor}`, name: vendor },
  ...extra,
});
const conf = (id, values) => ({
  _id: id,
  values: values.map(([attributeId, value]) => ({ attributeId, value })),
});
const part = (typeId, m, c, quantity = 1) => ({
  typeId,
  deviceModelId: m,
  configurationId: c,
  quantity,
});

const cpuPart = part(cpu, model("m1", "AMD", "Ryzen 5 8600G"), null);
const ramPart = part(
  ram,
  model("m2", "Kingston", "FURY Beast"),
  conf("c2", [[aSize, "8"], [aType, "DDR5"]]),
  2,
);
const ssdPart = part(
  ssd,
  model("m3", "Kingston", "NV3"),
  conf("c3", [[dSize, "500"], [dType, "SSD"]]),
);
const parts = [cpuPart, ramPart, ssdPart];

const keySpecs = [
  { typeId: cpu, source: "model", attributeId: null, aggregate: "first" },
  { typeId: ram, source: "attribute", attributeId: aSize, aggregate: "sum" },
  { typeId: ram, source: "attribute", attributeId: aType, aggregate: "first" },
  { typeId: ssd, source: "attribute", attributeId: dSize, aggregate: "sum" },
  { typeId: ssd, source: "attribute", attributeId: dType, aggregate: "list" },
];


test("partTitle: «Vendor Name», «без модели» и «модель удалена»", () => {
  assert.equal(partTitle(cpuPart), "AMD Ryzen 5 8600G");
  assert.equal(partTitle(part(cpu, null, null)), "без модели");
  assert.equal(
    partTitle(part(cpu, model("m", "A", "B", { deletedAt: "2026-01-01" }), null)),
    "модель удалена",
  );
});

test("buildKeySpecs: модель + сумма 2×8 ГБ = 16 ГБ + тип DDR5", () => {
  const e = buildKeySpecs(keySpecs, parts);
  assert.deepEqual(
    e.map((x) => [x.label, x.value]),
    [
      ["Процессор", "AMD Ryzen 5 8600G"],
      ["Оперативная память", "16 ГБ DDR5"],
      ["Накопитель", "500 ГБ SSD"],
    ],
  );
});

test("sum: текст и пусто пропущены, нет чисел — нет записи", () => {
  const p = [
    part(ram, model("m", "K", "X"), conf("c", [[aSize, "8"]])),
    part(ram, model("n", "K", "Y"), conf("d", [[aSize, "abc"]])),
    part(ram, model("o", "K", "Z"), conf("e", [[aSize, ""]])),
  ];
  const spec = [{ typeId: ram, source: "attribute", attributeId: aSize, aggregate: "sum" }];
  assert.equal(buildKeySpecs(spec, p)[0].value, "8 ГБ");
  assert.deepEqual(buildKeySpecs(spec, p.slice(1)), []);
  const frac = [part(ram, model("m", "K", "X"), conf("c", [[aSize, "0.1"]]), 3)];
  assert.equal(buildKeySpecs(spec, frac)[0].value, "0.3 ГБ");
});

test("list: различные через «, »", () => {
  const p = [
    part(ssd, model("a", "K", "A"), conf("c1", [[dType, "SSD"]])),
    part(ssd, model("b", "K", "B"), conf("c2", [[dType, "HDD"]])),
    part(ssd, model("c", "K", "C"), conf("c3", [[dType, "SSD"]])),
  ];
  const spec = [{ typeId: ssd, source: "attribute", attributeId: dType, aggregate: "list" }];
  assert.equal(buildKeySpecs(spec, p)[0].value, "SSD, HDD");
});

test("деталь без модели → «без модели», удалённая → «модель удалена», характеристики без них", () => {
  const gone = part(cpu, null, conf("c", [[aSize, "99"]]));
  const e = buildKeySpecs(
    [
      { typeId: cpu, source: "model", attributeId: null, aggregate: "first" },
      { typeId: cpu, source: "attribute", attributeId: aSize, aggregate: "sum" },
    ],
    [gone],
  );
  assert.equal(e.length, 1);
  assert.equal(e[0].value, "без модели");

  const dead = part(
    ram,
    model("m", "K", "X", { deletedAt: "2026-01-01" }),
    conf("c", [[aSize, "99"], [aType, "DDR5"]]),
  );
  const ks = [
    { typeId: ram, source: "model", attributeId: null, aggregate: "first" },
    { typeId: ram, source: "attribute", attributeId: aSize, aggregate: "sum" },
    { typeId: ram, source: "attribute", attributeId: aType, aggregate: "first" },
  ];
  const e2 = buildKeySpecs(ks, [dead]);
  assert.equal(e2.length, 1);
  assert.equal(e2[0].value, "модель удалена");
});

test("keySpecsLine соединяет через « · »", () => {
  assert.equal(
    keySpecsLine({ keySpecs }, parts),
    "AMD Ryzen 5 8600G · 16 ГБ DDR5 · 500 ГБ SSD",
  );
});

test("деталь вне слотов не попадает в keySpecs", () => {
  const extra = part(fan, model("m9", "Noctua", "NH-U12"), null);
  const slots = [{ typeId: cpu }, { typeId: ram }, { typeId: ssd }];
  const withFan = [
    ...keySpecs,
    { typeId: fan, source: "model", attributeId: null, aggregate: "first" },
  ];
  const all = [extra, ...parts];
  assert.ok(!buildKeySpecs(withFan, all, slots).some((e) => e.typeId === "t-fan"));
  assert.ok(!keySpecsLine({ keySpecs: withFan, slots }, all).includes("Noctua"));
});

test("liveAssembly: слоты и ключевые характеристики удалённых типов выпадают", () => {
  const assembly = {
    enabled: true,
    slots: [{ typeId: cpu, required: true }, { typeId: null, multiple: true }],
    keySpecs: [
      { typeId: null, source: "model", attributeId: null, aggregate: "first" },
      { typeId: cpu, source: "model", attributeId: null, aggregate: "first" },
    ],
  };
  const live = liveAssembly(assembly);
  assert.equal(live.enabled, true);
  assert.deepEqual(live.slots, [{ typeId: cpu, required: true }]);
  assert.deepEqual(live.keySpecs.map((s) => s.typeId), [cpu]);
  assert.deepEqual(liveAssembly(undefined), { slots: [], keySpecs: [] });
  assert.deepEqual(liveAssembly({ enabled: false }), { enabled: false, slots: [], keySpecs: [] });
});

test("удалённый тип (typeId: null) в слотах, keySpecs и деталях не роняет сводку", () => {
  const slots = [{ typeId: null }, { typeId: cpu }];
  const ks = [{ typeId: null, source: "model", attributeId: null, aggregate: "first" }, ...keySpecs];
  const orphan = part(null, model("m7", "X", "Y"), null);
  const all = [orphan, ...parts];
  assert.equal(buildKeySpecs(ks, all, slots).length, 1);
  assert.equal(keySpecsLine({ keySpecs: ks }, all), "AMD Ryzen 5 8600G · 16 ГБ DDR5 · 500 ГБ SSD");
});

test("formatSpecValue: да/нет, подпись опции, мультивыбор, единица", () => {
  assert.equal(formatSpecValue({ valueType: "boolean" }, "true"), "да");
  assert.equal(formatSpecValue({ valueType: "boolean" }, false), "нет");
  const opts = [{ value: "a", label: "Альфа" }, { value: "b", label: "Бета" }];
  assert.equal(formatSpecValue({ valueType: "select", options: opts }, "a"), "Альфа");
  assert.equal(
    formatSpecValue({ valueType: "multiselect", options: opts }, '["a","b"]'),
    "Альфа, Бета",
  );
  assert.equal(formatSpecValue({ valueType: "number", unit: '"' }, "27"), '27"');
  assert.equal(formatSpecValue({ valueType: "number", unit: "ГБ" }, "8"), "8 ГБ");
  assert.equal(formatSpecValue(null, ""), "");
});

test("серверные id (ObjectId-подобные) сравниваются по значению", () => {
  // typeId в сборке и в детали — разные объекты с равным _id
  const a = { _id: { toString: () => "x1" }, name: "Процессор" };
  const b = { _id: { toString: () => "x1" }, name: "Процессор" };
  const line = keySpecsLine(
    { keySpecs: [{ typeId: a, source: "model", aggregate: "first" }] },
    [part(b, model("m", "AMD", "R5"), null)],
  );
  assert.equal(line, "AMD R5");
});

// ─── loadKeySpecs: одна пачка на страницу ─────────────────────────────────

const chain = (counter, key, result) => {
  const c = {
    select: () => c,
    populate: () => c,
    lean: () => Promise.resolve(result),
  };
  counter[key] = (counter[key] || 0) + 1;
  return c;
};

test("loadKeySpecs: фиксированное число запросов на 3 ПК", async () => {
  const calls = {};
  const assembly = {
    enabled: true,
    slots: [{ typeId: cpu }, { typeId: ram }],
    keySpecs: [
      { typeId: cpu, source: "model", attributeId: null, aggregate: "first" },
      { typeId: ram, source: "attribute", attributeId: aSize, aggregate: "sum" },
    ],
  };
  const kid = (host, p) => ({ parentDeviceId: host, ...p, deviceTypeId: p.typeId });
  // Тип детали — через модель (deviceModelId.deviceTypeId), своего нет
  const viaModel = (host, p) => ({
    parentDeviceId: host,
    deviceModelId: { ...p.deviceModelId, deviceTypeId: p.typeId },
    configurationId: p.configurationId,
    quantity: p.quantity,
  });
  const children = [
    kid("h1", cpuPart),
    kid("h1", ramPart),
    kid("h2", cpuPart),
    kid("h3", { ...ramPart, quantity: 4 }),
    viaModel("h2", ramPart),
  ];
  const filterArgs = [];
  const deps = {
    ClientDevice: { find: () => chain(calls, "children", children) },
    DeviceType: { find: () => chain(calls, "types", [{ _id: "T1", assembly }]) },
    assemblyPopulate: [],
    componentPopulate: [],
    componentSelect: "",
    componentsFilter: (id) => {
      filterArgs.push(id);
      return { parentDeviceId: id };
    },
  };
  const rows = [
    { _id: "h1", deviceTypeId: { _id: "T1" } },
    { _id: "h2", deviceTypeId: { _id: "T1" } },
    { _id: "h3", deviceTypeId: { _id: "T1" } },
    { _id: "h4", deviceTypeId: { _id: "T1" }, deviceModelId: { _id: "m" } },
    { _id: "h5", deviceTypeId: { _id: "T2" } },
  ];
  const map = await loadKeySpecs(rows, deps);
  assert.deepEqual(calls, { types: 1, children: 1 });
  // Дети — одним запросом по хозяевам своей сборки (без h4 с моделью и h5 чужого типа)
  assert.deepEqual(filterArgs, [{ $in: ["h1", "h2", "h3"] }]);
  assert.equal(map.get("h1"), "AMD Ryzen 5 8600G · 16 ГБ");
  assert.equal(map.get("h2"), "AMD Ryzen 5 8600G · 16 ГБ");
  assert.equal(map.get("h3"), "32 ГБ");
  assert.equal(map.has("h4"), false);
  assert.equal(map.has("h5"), false);
});

test("loadKeySpecs: нет ПК своей сборки — запросов нет", async () => {
  const calls = {};
  const deps = {
    ClientDevice: { find: () => chain(calls, "children", []) },
    DeviceType: { find: () => chain(calls, "types", []) },
    componentsFilter: () => ({}),
  };
  const map = await loadKeySpecs([{ _id: "x", deviceModelId: { _id: "m" } }], deps);
  assert.equal(map.size, 0);
  assert.deepEqual(calls, {});
});
