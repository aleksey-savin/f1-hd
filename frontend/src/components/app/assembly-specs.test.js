// node --test src/components/app/assembly-specs.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAssemblyGroups,
  buildKeySpecs,
  buildPartRows,
  collapseDiffRows,
  connectedRows,
  devicePartsToAssembly,
  diffWithBuild,
  compactKeySpecsLine,
  keySpecsLine,
  liveAssembly,
  partTitle,
  shortPartTitle,
  warrantyNote,
} from "./assembly-specs.ts";

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

  // модель есть, но удалена, а у конфигурации есть значения
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
  assert.deepEqual(
    buildAssemblyGroups([dead], { "t-ram": [link(aSize, 0), link(aType, 1)] }),
    [],
  );
});

test("keySpecsLine соединяет через « · »", () => {
  assert.equal(
    keySpecsLine(keySpecs, parts),
    "AMD Ryzen 5 8600G · 16 ГБ DDR5 · 500 ГБ SSD",
  );
});

const grp = { _id: "g1", name: "Оперативная память", order: 1 };
const link = (attributeId, order, groupId = grp) => ({ _id: `l-${attributeId._id}`, attributeId, groupId, order });

test("buildAssemblyGroups: 2 × 8 ГБ, нечисловое без N ×", () => {
  const g = buildAssemblyGroups([ramPart], { "t-ram": [link(aType, 0), link(aSize, 1)] });
  assert.equal(g.length, 1);
  assert.deepEqual(
    g[0].rows.map((r) => [r.label, r.value]),
    [["Тип памяти", "DDR5"], ["Объём модуля", "2 × 8 ГБ"]],
  );
});

test("разные накопители → «500 ГБ + 2000 ГБ»", () => {
  const second = part(ssd, model("m4", "WD", "Blue"), conf("c4", [[dSize, "2000"]]));
  const g = buildAssemblyGroups([ssdPart, second], { "t-ssd": [link(dSize, 0, null)] }, { otherLabel: "Иное" });
  assert.equal(g[0].name, "Иное");
  assert.equal(g[0].rows[0].value, "500 ГБ + 2000 ГБ");
});

test("buildAssemblyGroups: деталь без модели не даёт строк", () => {
  const g = buildAssemblyGroups(
    [part(ssd, null, conf("c", [[dSize, "1"]]))],
    { "t-ssd": [link(dSize, 0)] },
  );
  assert.deepEqual(g, []);
});

test("деталь вне слотов — в конце buildPartRows, не в keySpecs", () => {
  const extra = part(fan, model("m9", "Noctua", "NH-U12"), null);
  const slots = [{ typeId: cpu }, { typeId: ram, multiple: true }, { typeId: ssd }];
  const rows = buildPartRows(slots, [extra, ssdPart, ramPart, cpuPart]);
  assert.deepEqual(
    rows.map((r) => [r.label, r.title, r.quantity]),
    [
      ["Процессор", "AMD Ryzen 5 8600G", 1],
      ["Оперативная память", "Kingston FURY Beast", 2],
      ["Накопитель", "Kingston NV3", 1],
      ["Кулер", "Noctua NH-U12", 1],
    ],
  );
  assert.equal(rows[0].modelId, "m1");
  // keySpecs могут ссылаться только на слотовые типы; чужой тип игнорируется
  const withFan = [
    ...keySpecs,
    { typeId: fan, source: "model", attributeId: null, aggregate: "first" },
  ];
  const all = [extra, ...parts];
  const entries = buildKeySpecs(withFan, all, slots);
  assert.ok(!entries.some((e) => e.typeId === "t-fan"));
  assert.ok(!keySpecsLine(withFan, all, slots).includes("Noctua"));
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
  assert.equal(keySpecsLine(ks, all), "AMD Ryzen 5 8600G · 16 ГБ DDR5 · 500 ГБ SSD");
  assert.deepEqual(
    buildPartRows(slots, all).map((r) => r.label),
    ["Процессор", "Оперативная память", "Накопитель"],
  );
  assert.doesNotThrow(() => buildAssemblyGroups(all, { "t-ram": [link(aSize, 0)] }));
});

test("buildAssemblyGroups: значение атрибута, снятого с типа детали, — в «Прочее»", () => {
  // У памяти связан только «Объём модуля» (в группе); «Тип памяти» снят с типа
  const g = buildAssemblyGroups([ramPart], { "t-ram": [link(aSize, 0)] });
  assert.deepEqual(
    g.map((x) => [x.name, x.rows.map((r) => [r.label, r.value])]),
    [
      ["Оперативная память", [["Объём модуля", "2 × 8 ГБ"]]],
      ["Прочее", [["Тип памяти", "DDR5"]]],
    ],
  );
  // Есть связка без группы — «Прочее» уже в порядке, строки идут по деталям
  const g2 = buildAssemblyGroups(
    [ramPart, ssdPart],
    { "t-ram": [link(aSize, 0)], "t-ssd": [link(dSize, 0, null)] },
    { otherLabel: "Иное" },
  );
  assert.deepEqual(
    g2.map((x) => [x.name, x.rows.map((r) => r.label)]),
    [
      ["Оперативная память", ["Объём модуля"]],
      ["Иное", ["Тип памяти", "Объём накопителя", "Тип накопителя"]],
    ],
  );
});

// ---- Детали устройства как сборка ----

test("devicePartsToAssembly: тип модели, иначе deviceTypeId; поля устройства", () => {
  const out = devicePartsToAssembly([
    {
      _id: "d1",
      deviceModelId: { ...model("m1", "AMD", "Ryzen"), deviceTypeId: cpu },
      deviceTypeId: ram,
      configurationId: null,
      quantity: 1,
      serialNumber: "SN1",
      warrantyExpirationDate: "2029-10-19T00:00:00.000Z",
    },
    { _id: "d2", deviceModelId: null, deviceTypeId: ssd, quantity: 2 },
  ]);
  assert.equal(out[0].typeId._id, "t-cpu");
  assert.equal(out[0].deviceId, "d1");
  assert.equal(out[0].serialNumber, "SN1");
  assert.equal(out[0].warrantyExpirationDate, "2029-10-19T00:00:00.000Z");
  assert.equal(out[1].typeId._id, "t-ssd");
  assert.equal(out[1].quantity, 2);
  assert.equal(out[1].deviceId, "d2");
});

const slotsPc = [
  { typeId: cpu, required: true, multiple: false },
  { typeId: ram, required: true, multiple: true },
  { typeId: ssd, required: false, multiple: true },
];
const mRam = model("m2", "Kingston", "FURY Beast");
const mRam2 = model("m9", "Corsair", "Vengeance");
const rp = (m, q = 1) => ({ ...part(ram, m, null, q), deviceId: `d-${m._id}` });

test("diffWithBuild: совпадение без меток, по строке на единицу", () => {
  const d = diffWithBuild(slotsPc, [cpuPart, ramPart], [cpuPart, rp(mRam, 2)]);
  assert.deepEqual(d.rows.map((r) => [r.slotLabel, r.tag]), [
    ["Процессор", null],
    ["Оперативная память", null],
    ["Оперативная память", null],
  ]);
  assert.deepEqual(d.missingRequired, []);
});

test("diffWithBuild: заменена с моделью сборки", () => {
  const d = diffWithBuild(slotsPc, [cpuPart, ramPart], [cpuPart, rp(mRam), rp(mRam2)]);
  const ramRows = d.rows.filter((r) => r.typeId._id === "t-ram");
  assert.deepEqual(ramRows.map((r) => r.tag), [null, "replaced"]);
  assert.equal(ramRows[1].buildTitle, "Kingston FURY Beast");
  assert.equal(ramRows[1].part.deviceModelId._id, "m9");
});

test("diffWithBuild: добавлена (лишняя единица) и не установлена (недостаёт)", () => {
  const added = diffWithBuild(slotsPc, [cpuPart, ramPart], [cpuPart, rp(mRam, 3)]);
  assert.deepEqual(
    added.rows.filter((r) => r.typeId._id === "t-ram").map((r) => r.tag),
    [null, null, "added"],
  );
  // Недостающая единица в multiple-слоте
  const miss = diffWithBuild(slotsPc, [cpuPart, ramPart], [cpuPart, rp(mRam)]);
  const last = miss.rows[miss.rows.length - 1];
  assert.equal(last.tag, "missing");
  assert.equal(last.part, null);
  assert.equal(last.buildTitle, "Kingston FURY Beast");
  // Целиком отсутствующий слот сборки
  const none = diffWithBuild(slotsPc, [cpuPart], [cpuPart]);
  assert.deepEqual(none.rows.map((r) => r.tag), [null]);
  const none2 = diffWithBuild(slotsPc, [cpuPart, ssdPart], [cpuPart]);
  assert.equal(none2.rows[1].tag, "missing");
  assert.equal(none2.rows[1].slotLabel, "Накопитель");
});

test("diffWithBuild: слота нет в сборке — каждая единица «добавлена»", () => {
  const d = diffWithBuild(slotsPc, [cpuPart, ramPart], [
    cpuPart,
    rp(mRam, 2),
    { ...ssdPart, quantity: 2, deviceId: "d-ssd" },
  ]);
  const ssdRows = d.rows.filter((r) => r.typeId._id === "t-ssd");
  assert.deepEqual(ssdRows.map((r) => r.tag), ["added", "added"]);
  assert.ok(ssdRows.every((r) => r.buildTitle === undefined));
});

test("diffWithBuild: единица без модели — «заменена» моделью сборки", () => {
  const bare = { ...part(ram, null, null), deviceId: "d-bare" };
  const d = diffWithBuild(slotsPc, [cpuPart, ramPart], [cpuPart, rp(mRam), bare]);
  const ramRows = d.rows.filter((r) => r.typeId._id === "t-ram");
  assert.deepEqual(ramRows.map((r) => r.tag), [null, "replaced"]);
  assert.equal(ramRows[1].part.deviceId, "d-bare");
  assert.equal(ramRows[1].buildTitle, "Kingston FURY Beast");
  assert.equal(partTitle(ramRows[1].part), "без модели");
});

test("diffWithBuild: без сборки — только missingRequired", () => {
  const d = diffWithBuild(slotsPc, null, [cpuPart]);
  assert.deepEqual(d.rows.map((r) => r.tag), [null]);
  assert.deepEqual(d.missingRequired, ["Оперативная память"]);
});

test("warrantyNote: три тона, граница 30 дней, склонение", () => {
  const today = new Date(2026, 9, 19);
  assert.deepEqual(warrantyNote("2029-10-19T00:00:00.000Z", today), {
    text: "гарантия до 19.10.2029",
    tone: "normal",
  });
  assert.deepEqual(warrantyNote("2026-10-28", today), {
    text: "гарантия до 28.10.2026 — через 9 дней",
    tone: "soon",
  });
  assert.equal(warrantyNote("2026-11-18", today).tone, "soon");
  assert.equal(warrantyNote("2026-11-19", today).tone, "normal");
  assert.equal(warrantyNote("2026-10-19", today).text, "гарантия до 19.10.2026 — через 0 дней");
  assert.equal(warrantyNote("2026-10-20", today).text, "гарантия до 20.10.2026 — через 1 день");
  assert.equal(warrantyNote("2026-10-22", today).text, "гарантия до 22.10.2026 — через 3 дня");
  assert.equal(warrantyNote("2026-10-31", today).text, "гарантия до 31.10.2026 — через 12 дней");
  assert.deepEqual(warrantyNote("2026-06-01", today), {
    text: "гарантия истекла 01.06.2026",
    tone: "expired",
  });
  assert.equal(warrantyNote(null, today), null);
  assert.equal(warrantyNote("", today), null);
});

test("collapseDiffRows: одинаковые без метки — одной строкой, устройства без повторов", () => {
  const r1 = { ...rp(mRam), deviceId: "d-a" };
  const r2 = { ...rp(mRam), deviceId: "d-b" };
  const d = diffWithBuild(slotsPc, [cpuPart, part(ram, mRam, null, 2)], [cpuPart, r1, r2]);
  const rows = collapseDiffRows(d.rows);
  assert.deepEqual(rows.map((r) => [r.slotLabel, r.units, r.devices.length]), [
    ["Процессор", 1, 1],
    ["Оперативная память", 2, 2],
  ]);
  // Одно устройство на 2 штуки — одна строка × 2 с одним устройством
  const one = collapseDiffRows(diffWithBuild(slotsPc, null, [cpuPart, rp(mRam, 2)]).rows);
  assert.deepEqual(one.map((r) => [r.units, r.devices.length]), [[1, 1], [2, 1]]);
});

test("collapseDiffRows: помеченные и не установленные — по одной", () => {
  const d = diffWithBuild(slotsPc, [cpuPart, ramPart], [cpuPart, rp(mRam, 3)]);
  const ramRows = collapseDiffRows(d.rows).filter((r) => r.typeId._id === "t-ram");
  assert.deepEqual(ramRows.map((r) => [r.tag, r.units]), [
    [null, 2],
    ["added", 1],
  ]);
  const miss = collapseDiffRows(diffWithBuild(slotsPc, [cpuPart, ramPart], [cpuPart]).rows);
  const missing = miss.filter((r) => r.tag === "missing");
  assert.ok(missing.length > 0);
  for (const r of missing) {
    assert.equal(r.units, 0);
    assert.deepEqual(r.devices, []);
  }
});

test("connectedRows: строка на устройство, тип — подпись, × quantity", () => {
  const rows = connectedRows(
    devicePartsToAssembly([
      { _id: "d-mon", deviceModelId: null, deviceTypeId: T("t-mon", "Монитор"), quantity: 2 },
      { _id: "d-x", deviceModelId: null, deviceTypeId: null },
    ]),
  );
  assert.deepEqual(
    rows.map((r) => [r.slotLabel, r.units, r.tag, r.devices[0].deviceId]),
    [
      ["Монитор", 2, null, "d-mon"],
      ["Устройство", 1, null, "d-x"],
    ],
  );
});

test("shortPartTitle: модель без производителя и без хвостов в скобках", () => {
  const gpu = model(
    "m9",
    "Gigabyte",
    "GeForce RTX 3060 WINDFORCE OC (rev. 2.0) [GV-N3060WF2OC-12GD 2.0]",
  );
  assert.equal(shortPartTitle(part(cpu, gpu, null)), "GeForce RTX 3060 WINDFORCE OC");
  // Производитель, вписанный в имя модели, тоже срезается
  assert.equal(
    shortPartTitle(part(cpu, model("m8", "AMD", "AMD Ryzen 7 5700X3D OEM"), null)),
    "Ryzen 7 5700X3D OEM",
  );
  // Имя целиком в скобках не теряется
  assert.equal(shortPartTitle(part(cpu, model("m7", "X", "(OEM)"), null)), "(OEM)");
  assert.equal(shortPartTitle(part(cpu, null, null)), "без модели");
});

test("compactKeySpecsLine: модели короткими именами, атрибуты как есть", () => {
  assert.equal(
    compactKeySpecsLine(keySpecs, parts),
    "Ryzen 5 8600G · 16 ГБ DDR5 · 500 ГБ SSD",
  );
  assert.equal(keySpecsLine(keySpecs, parts), "AMD Ryzen 5 8600G · 16 ГБ DDR5 · 500 ГБ SSD");
});
