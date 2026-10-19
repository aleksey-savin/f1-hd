// node --test services/inventory/catalogSeed.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { planCatalog, applyCatalog } = require("./catalogSeed");

// Небольшой каталог: две группы, комплектующая и заводской тип, общие атрибуты.
const catalog = {
  groups: [
    { key: "cpu", name: "Процессор", order: 0 },
    { key: "screen", name: "Экран", order: 1 },
  ],
  attributes: [
    {
      key: "socket",
      code: "socket",
      name: "Сокет",
      valueType: "select",
      options: [
        { value: "AM4", label: "AM4" },
        { value: "AM5", label: "AM5" },
        { value: "LGA1700", label: "LGA1700" },
      ],
    },
    { key: "cores", code: "cores_total", name: "Общее количество ядер", valueType: "number", unit: "шт" },
    { key: "diagonal", code: "screen_diagonal", name: "Диагональ экрана", valueType: "number", unit: '"' },
    { key: "psuPower", code: "psu_power", name: "Мощность", valueType: "number", unit: "Вт" },
  ],
  types: [
    {
      key: "cpu",
      name: "Процессор",
      flags: { isComponent: true },
      attributes: [
        { attr: "socket", group: "cpu", required: true },
        { attr: "cores", group: "cpu" },
      ],
    },
    {
      key: "laptop",
      name: "Ноутбук",
      attributes: [
        { attr: "diagonal", group: "screen" },
        { attr: "cores", group: "cpu" },
      ],
    },
    {
      key: "psu",
      name: "Блок питания",
      flags: { isComponent: true },
      attributes: [{ attr: "psuPower", group: null }],
    },
  ],
};

const empty = () => ({ groups: [], types: [], attributes: [], links: [] });

const isEmptyPlan = (plan) => {
  for (const list of Object.values(plan.create)) assert.deepEqual(list, []);
  for (const list of Object.values(plan.update)) assert.deepEqual(list, []);
};

// Записывает план в «базу» так, как это сделал бы applyCatalog (без Mongo).
let nextId = 1;
const materialize = (plan, existing) => {
  const db = structuredClone(existing);
  const ids = {
    groups: { ...plan.matched.groups },
    types: { ...plan.matched.types },
    attributes: { ...plan.matched.attributes },
  };
  for (const group of plan.create.groups) {
    const _id = `g${nextId++}`;
    ids.groups[group.key] = _id;
    db.groups.push({ _id, name: group.name, order: group.order });
  }
  for (const type of plan.create.types) {
    const _id = `t${nextId++}`;
    ids.types[type.key] = _id;
    db.types.push({ _id, name: type.name, isComponent: false, ...type.flags });
  }
  for (const attr of plan.create.attributes) {
    const _id = `a${nextId++}`;
    ids.attributes[attr.key] = _id;
    const { key: _key, ...doc } = attr;
    db.attributes.push({ _id, ...doc });
  }
  for (const link of plan.create.links) {
    db.links.push({
      _id: `l${nextId++}`,
      deviceTypeId: ids.types[link.typeKey],
      attributeId: ids.attributes[link.attrKey],
      groupId: link.groupKey ? ids.groups[link.groupKey] : null,
      order: link.order,
    });
  }
  for (const { _id, add } of plan.update.attributeOptions) {
    const attr = db.attributes.find((item) => item._id === _id);
    attr.options = [...(attr.options || []), ...add];
  }
  for (const { _id, groupKey } of plan.update.linkGroups) {
    db.links.find((item) => item._id === _id).groupId = ids.groups[groupKey];
  }
  for (const { _id, set } of plan.update.typeFlags) {
    Object.assign(db.types.find((item) => item._id === _id), set);
  }
  for (const { typeKey, assembly } of plan.update.typeAssembly || []) {
    const type = db.types.find((item) => item._id === ids.types[typeKey]);
    type.assembly = {
      enabled: assembly.enabled,
      slots: assembly.slots.map((slot) => ({
        typeId: ids.types[slot.typeKey],
        required: slot.required,
        multiple: slot.multiple,
      })),
      keySpecs: assembly.keySpecs.map((spec) => ({
        typeId: ids.types[spec.typeKey],
        source: spec.source,
        attributeId: spec.attrKey ? ids.attributes[spec.attrKey] : null,
        aggregate: spec.aggregate,
      })),
    };
  }
  return db;
};

test("пустая база: всё в create, предупреждений нет", () => {
  const plan = planCatalog(catalog, empty());
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(
    plan.create.groups.map((g) => [g.key, g.name, g.order]),
    [
      ["cpu", "Процессор", 0],
      ["screen", "Экран", 1],
    ],
  );
  assert.deepEqual(
    plan.create.types.map((t) => [t.key, t.flags]),
    [
      ["cpu", { isComponent: true }],
      ["laptop", {}],
      ["psu", { isComponent: true }],
    ],
  );
  assert.deepEqual(
    plan.create.attributes.map((a) => a.code),
    ["socket", "cores_total", "screen_diagonal", "psu_power"],
  );
  assert.deepEqual(
    plan.create.links.map((l) => [l.typeKey, l.attrKey, l.groupKey, l.required, l.order]),
    [
      ["cpu", "socket", "cpu", true, 0],
      ["cpu", "cores", "cpu", false, 1],
      ["laptop", "diagonal", "screen", false, 0],
      ["laptop", "cores", "cpu", false, 1],
      ["psu", "psuPower", null, false, 0],
    ],
  );
  isEmptyPlan({ create: {}, update: plan.update });
});

test("повторный план по результату первого пуст (идемпотентность)", () => {
  const first = planCatalog(catalog, empty());
  const seeded = materialize(first, empty());
  const second = planCatalog(catalog, seeded);
  isEmptyPlan(second);
  assert.deepEqual(second.warnings, []);
});

test("переименованный владельцем тип при повторном плане создаётся заново — поэтому сид идёт по журналу", () => {
  // Сам планировщик подхватывает только по имени; защита от воскрешения —
  // журнал `seeds` (см. scripts/seed.test.js, pendingSeeds).
  const seeded = materialize(planCatalog(catalog, empty()), empty());
  seeded.types.find((t) => t.name === "Ноутбук").name = "Лэптоп";
  const plan = planCatalog(catalog, seeded);
  assert.deepEqual(plan.create.types.map((t) => t.name), ["Ноутбук"]);
});

test("атрибут в другом регистре и с другим типом значения подхватывается с предупреждением", () => {
  const existing = empty();
  existing.attributes.push({
    _id: "old-diagonal",
    code: "diagonal",
    name: "диагональ ЭКРАНА",
    valueType: "select",
    options: [{ value: "15.6", label: "15.6" }],
  });
  const plan = planCatalog(catalog, existing);
  assert.equal(plan.matched.attributes.diagonal, "old-diagonal");
  assert.ok(!plan.create.attributes.some((a) => a.key === "diagonal"));
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /диагональ ЭКРАНА/);
  // Каталожная связка ведёт на подхваченный атрибут
  const link = plan.create.links.find((l) => l.attrKey === "diagonal");
  assert.equal(link.typeKey, "laptop");
});

test("атрибут подхватывается и по коду, если имя другое", () => {
  const existing = empty();
  existing.attributes.push({ _id: "a-sock", code: "socket", name: "Разъём процессора", valueType: "select", options: [] });
  const plan = planCatalog(catalog, existing);
  assert.equal(plan.matched.attributes.socket, "a-sock");
  assert.ok(!plan.create.attributes.some((a) => a.key === "socket"));
});

test("select получает только недостающие варианты, сравнение без учёта регистра", () => {
  const existing = empty();
  existing.attributes.push({
    _id: "a-socket",
    code: "cpu_socket",
    name: "Сокет",
    valueType: "select",
    options: [
      { value: "am4", label: "AM4" },
      { value: "AM5", label: "AM5" },
    ],
  });
  const plan = planCatalog(catalog, existing);
  assert.deepEqual(plan.update.attributeOptions, [
    { _id: "a-socket", add: [{ value: "LGA1700", label: "LGA1700" }] },
  ]);
  assert.deepEqual(plan.warnings, []);
});

test("связка без группы получает группу из каталога, с группой — не трогается", () => {
  const seeded = materialize(planCatalog(catalog, empty()), empty());
  const cpuType = seeded.types.find((t) => t.name === "Процессор");
  const socket = seeded.attributes.find((a) => a.code === "socket");
  const cores = seeded.attributes.find((a) => a.code === "cores_total");
  const socketLink = seeded.links.find((l) => l.deviceTypeId === cpuType._id && l.attributeId === socket._id);
  const coresLink = seeded.links.find((l) => l.deviceTypeId === cpuType._id && l.attributeId === cores._id);
  socketLink.groupId = null;
  coresLink.groupId = "owner-group"; // владелец перенёс в свою группу

  const plan = planCatalog(catalog, seeded);
  assert.deepEqual(plan.update.linkGroups, [{ _id: socketLink._id, groupKey: "cpu" }]);
  assert.deepEqual(plan.create.links, []);
});

test("подхваченный тип-комплектующая без флага получает isComponent", () => {
  const existing = empty();
  existing.types.push({ _id: "t-psu", name: "блок питания", isComponent: false });
  existing.types.push({ _id: "t-laptop", name: "Ноутбук", isComponent: false });
  const plan = planCatalog(catalog, existing);
  assert.deepEqual(plan.update.typeFlags, [{ _id: "t-psu", set: { isComponent: true } }]);
  assert.ok(!plan.create.types.some((t) => t.key === "psu"));
});

test("новые группы встают за существующими, новые связки — за последней связкой типа", () => {
  const existing = empty();
  existing.groups.push({ _id: "g-own", name: "Своя", order: 7 });
  existing.groups.push({ _id: "g-cpu", name: "процессор", order: 2 });
  existing.types.push({ _id: "t-laptop", name: "Ноутбук" });
  existing.attributes.push({ _id: "a-x", code: "x", name: "Икс", valueType: "string" });
  existing.links.push({ _id: "l-x", deviceTypeId: "t-laptop", attributeId: "a-x", groupId: null, order: 4 });
  const plan = planCatalog(catalog, existing);
  assert.deepEqual(plan.create.groups.map((g) => [g.name, g.order]), [["Экран", 9]]);
  assert.equal(plan.matched.groups.cpu, "g-cpu");
  assert.deepEqual(
    plan.create.links.filter((l) => l.typeKey === "laptop").map((l) => [l.attrKey, l.order]),
    [
      ["diagonal", 5],
      ["cores", 6],
    ],
  );
});

test("дубли имён и кодов внутри каталога — в предупреждениях", () => {
  const bad = structuredClone(catalog);
  bad.attributes.push({ key: "ram", code: "socket", name: "сокет", valueType: "number" });
  const plan = planCatalog(bad, empty());
  assert.equal(plan.warnings.length, 2);
  assert.match(plan.warnings.join("\n"), /socket/);
});

test("неизвестные ключи атрибута и группы у типа — предупреждение, не связка в пустоту", () => {
  const bad = structuredClone(catalog);
  bad.types[1].attributes.push({ attr: "nope", group: "cpu" }, { attr: "psuPower", group: "nope" });
  const plan = planCatalog(bad, empty());
  assert.equal(plan.warnings.length, 2);
  assert.ok(!plan.create.links.some((l) => l.attrKey === "nope"));
  const link = plan.create.links.find((l) => l.typeKey === "laptop" && l.attrKey === "psuPower");
  assert.equal(link.groupKey, null);
});

// --- applyCatalog на подставных моделях --------------------------------------

const fakeModel = (rows, { failOn } = {}) => {
  let seq = 0;
  const model = {
    rows,
    deleted: [],
    find: () => ({ select: () => ({ lean: async () => rows.map((row) => ({ ...row })) }) }),
    exists: async (filter) => rows.some((row) => row.code === filter.code),
    create: async (doc) => {
      if (failOn && failOn(doc)) throw new Error("insert failed");
      const row = { _id: `${doc.name || doc.attributeId}#${seq++}`, ...doc };
      rows.push(row);
      return row;
    },
    updateOne: async () => ({}),
    deleteMany: async ({ _id }) => {
      model.deleted.push(..._id.$in);
      for (const id of _id.$in) rows.splice(rows.findIndex((row) => row._id === id), 1);
    },
  };
  return model;
};

test("applyCatalog: сбой — созданное удаляется по списку _id, ошибка пробрасывается", async () => {
  const models = {
    AttributeGroup: fakeModel([{ _id: "own", name: "Своя", order: 0 }]),
    DeviceType: fakeModel([]),
    DeviceAttribute: fakeModel([]),
    DeviceTypeAttribute: fakeModel([], { failOn: (doc) => doc.order === 1 }),
  };
  await assert.rejects(applyCatalog(catalog, { log: () => {}, models }), /insert failed/);
  assert.deepEqual(models.AttributeGroup.rows.map((g) => g._id), ["own"]);
  assert.equal(models.DeviceType.rows.length, 0);
  assert.equal(models.DeviceAttribute.rows.length, 0);
  assert.equal(models.DeviceTypeAttribute.rows.length, 0);
  assert.equal(models.DeviceTypeAttribute.deleted.length, 1);
});

test("applyCatalog: сбой самого отката не подменяет исходную ошибку", async () => {
  const logs = [];
  const broken = fakeModel([], { failOn: (doc) => doc.order === 1 });
  broken.modelName = "DeviceTypeAttribute";
  broken.deleteMany = async () => {
    throw new Error("delete failed");
  };
  const models = {
    AttributeGroup: fakeModel([]),
    DeviceType: fakeModel([]),
    DeviceAttribute: fakeModel([]),
    DeviceTypeAttribute: broken,
  };
  await assert.rejects(
    applyCatalog(catalog, { log: (line) => logs.push(line), models }),
    /insert failed/,
  );
  assert.ok(logs.some((line) => /rollback failed for DeviceTypeAttribute: delete failed/.test(line)));
  // Остальные модели откатились, несмотря на сбой первой
  assert.equal(models.DeviceType.rows.length, 0);
  assert.equal(models.AttributeGroup.rows.length, 0);
});

test("applyCatalog: считает созданное и подхваченное", async () => {
  const models = {
    AttributeGroup: fakeModel([]),
    DeviceType: fakeModel([{ _id: "t-psu", name: "Блок питания", isComponent: false }]),
    DeviceAttribute: fakeModel([]),
    DeviceTypeAttribute: fakeModel([]),
  };
  const lines = [];
  const result = await applyCatalog(catalog, { log: (line) => lines.push(line), models });
  assert.deepEqual(result.created, { groups: 2, types: 2, attributes: 4, links: 5 });
  assert.deepEqual(result.updated, { attributeOptions: 0, linkGroups: 0, typeFlags: 1, typeAssembly: 0 });
  assert.deepEqual(result.warnings, []);
  assert.ok(lines.length > 0);
});

// Санитар первого сида: каталог приложения A сам по себе без ошибок.
test("первый сид каталога: на пустой базе без предупреждений, ключи и имена целы", () => {
  const { catalog: seedCatalog } = require("../../scripts/seeds/2026-10-19-inventoryCatalog");
  const plan = planCatalog(seedCatalog, empty());
  // Сюда попадают дубли имён/кодов атрибутов и неизвестные ключи у связок
  assert.deepEqual(plan.warnings, []);

  const fold = (value) => value.trim().toLocaleLowerCase("ru");
  const unique = (list, label) => {
    const seen = new Set();
    for (const value of list) {
      assert.ok(!seen.has(value), `${label}: «${value}» повторяется`);
      seen.add(value);
    }
  };
  unique(seedCatalog.groups.map((g) => g.key), "ключ группы");
  unique(seedCatalog.groups.map((g) => fold(g.name)), "группа");
  unique(seedCatalog.types.map((t) => t.key), "ключ типа");
  unique(seedCatalog.types.map((t) => fold(t.name)), "тип");
  unique(seedCatalog.attributes.map((a) => a.key), "ключ атрибута");
  unique(seedCatalog.attributes.map((a) => fold(a.code)), "код атрибута");
  unique(seedCatalog.attributes.map((a) => fold(a.name)), "атрибут");

  const groupKeys = new Set(seedCatalog.groups.map((g) => g.key));
  const attrKeys = new Set(seedCatalog.attributes.map((a) => a.key));
  for (const type of seedCatalog.types) {
    assert.ok(type.attributes.length > 0, `у типа «${type.name}» нет атрибутов`);
    for (const link of type.attributes) {
      assert.ok(attrKeys.has(link.attr), `${type.name}: неизвестный атрибут ${link.attr}`);
      assert.ok(groupKeys.has(link.group), `${type.name}: неизвестная группа ${link.group}`);
    }
  }
  for (const attr of seedCatalog.attributes) {
    assert.match(attr.code, /^[a-z0-9_]+$/, `код «${attr.code}» не латиница в нижнем регистре`);
  }

  // Каждый атрибут каталога у кого-то стоит, и всё создаётся одним прогоном
  const linked = new Set(seedCatalog.types.flatMap((t) => t.attributes.map((l) => l.attr)));
  assert.deepEqual(seedCatalog.attributes.filter((a) => !linked.has(a.key)).map((a) => a.key), []);
  assert.equal(plan.create.attributes.length, seedCatalog.attributes.length);
  assert.equal(plan.create.types.length, seedCatalog.types.length);
});

// --- «Своя сборка» у типа: слоты и ключевые характеристики -----------------

// Собираемый тип поверх основного каталога: процессор и блок питания в слотах.
const withAssembly = (assembly) => {
  const next = structuredClone(catalog);
  next.types.push({ key: "pc", name: "Системный блок", attributes: [], assembly });
  return next;
};

const pcAssembly = {
  slots: [
    { type: "cpu", required: true },
    { type: "psu", required: true, multiple: false },
  ],
  keySpecs: [
    { type: "cpu", source: "model", aggregate: "first" },
    { type: "cpu", source: "attribute", attr: "cores", aggregate: "sum" },
    { type: "psu", source: "attribute", attr: "psuPower", aggregate: "list" },
  ],
};

const pcPlanned = {
  enabled: true,
  slots: [
    { typeKey: "cpu", required: true, multiple: false },
    { typeKey: "psu", required: true, multiple: false },
  ],
  keySpecs: [
    { typeKey: "cpu", source: "model", attrKey: null, aggregate: "first" },
    { typeKey: "cpu", source: "attribute", attrKey: "cores", aggregate: "sum" },
    { typeKey: "psu", source: "attribute", attrKey: "psuPower", aggregate: "list" },
  ],
};

test("typeAssembly: подхваченному типу без слотов ставится, вместе с enabled", () => {
  const existing = materialize(planCatalog(catalog, empty()), empty());
  existing.types.push({ _id: "t-pc", name: "системный блок", isComponent: false });
  const plan = planCatalog(withAssembly(pcAssembly), existing);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.update.typeAssembly, [
    { _id: "t-pc", typeKey: "pc", assembly: pcPlanned },
  ]);
  for (const list of Object.values(plan.create)) assert.deepEqual(list, []);
});

test("typeAssembly: у типа с пустой сборкой (enabled=false, слотов нет) — тоже ставится", () => {
  const existing = materialize(planCatalog(catalog, empty()), empty());
  existing.types.push({
    _id: "t-pc",
    name: "Системный блок",
    assembly: { enabled: false, slots: [], keySpecs: [] },
  });
  const plan = planCatalog(withAssembly(pcAssembly), existing);
  assert.equal(plan.update.typeAssembly.length, 1);
});

test("typeAssembly: у типа со слотами — не трогается и без предупреждения", () => {
  const existing = materialize(planCatalog(catalog, empty()), empty());
  existing.types.push({
    _id: "t-pc",
    name: "Системный блок",
    assembly: { enabled: false, slots: [{ typeId: "own", required: false, multiple: true }], keySpecs: [] },
  });
  const plan = planCatalog(withAssembly(pcAssembly), existing);
  assert.deepEqual(plan.update.typeAssembly, []);
  assert.deepEqual(plan.warnings, []);
});

test("typeAssembly: новый тип получает сборку по ключу (на пустой базе)", () => {
  const plan = planCatalog(withAssembly(pcAssembly), empty());
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.update.typeAssembly, [
    { _id: null, typeKey: "pc", assembly: pcPlanned },
  ]);
});

test("typeAssembly: неизвестные и недопустимые ключи — предупреждения, запись пропускается", () => {
  const plan = planCatalog(
    withAssembly({
      slots: [
        { type: "cpu", required: true },
        { type: "nope" }, // нет такого типа
        { type: "laptop" }, // не комплектующая
        { type: "cpu" }, // повтор
      ],
      keySpecs: [
        { type: "cpu", source: "model", aggregate: "first" },
        { type: "psu", source: "model", aggregate: "first" }, // не слот
        { type: "cpu", source: "attribute", attr: "nope", aggregate: "list" }, // нет атрибута
        { type: "cpu", source: "attribute", attr: "diagonal", aggregate: "list" }, // не у типа
        { type: "cpu", source: "attribute", attr: "socket", aggregate: "sum" }, // сумма не по числу
        { type: "cpu", source: "spec", aggregate: "first" }, // неверный источник
        { type: "cpu", source: "model", aggregate: "avg" }, // неверное сведение
      ],
    }),
    empty(),
  );
  assert.equal(plan.warnings.length, 9, plan.warnings.join("\n"));
  const [entry] = plan.update.typeAssembly;
  assert.deepEqual(entry.assembly.slots, [{ typeKey: "cpu", required: true, multiple: false }]);
  assert.deepEqual(entry.assembly.keySpecs, [
    { typeKey: "cpu", source: "model", attrKey: null, aggregate: "first" },
  ]);
});

test("typeAssembly: сумма — по типу значения подхваченного атрибута, не каталога", () => {
  const existing = materialize(planCatalog(catalog, empty()), empty());
  existing.attributes.find((a) => a.code === "cores_total").valueType = "string";
  const plan = planCatalog(withAssembly(pcAssembly), existing);
  // предупреждение о расхождении типа + сумма не по числу
  assert.equal(plan.warnings.length, 2, plan.warnings.join("\n"));
  assert.ok(plan.warnings.some((w) => /Сумм|сумм/.test(w)));
  assert.deepEqual(
    plan.update.typeAssembly[0].assembly.keySpecs.map((s) => s.attrKey),
    [null, "psuPower"],
  );
});

test("typeAssembly: ни одного годного слота — сборка не ставится", () => {
  const plan = planCatalog(withAssembly({ slots: [{ type: "nope" }], keySpecs: [] }), empty());
  assert.deepEqual(plan.update.typeAssembly, []);
  assert.equal(plan.warnings.length, 1);
});

test("typeAssembly: повторный план по результату пуст", () => {
  const next = withAssembly(pcAssembly);
  const seeded = materialize(planCatalog(next, empty()), empty());
  const plan = planCatalog(next, seeded);
  isEmptyPlan(plan);
  assert.deepEqual(plan.warnings, []);
});

test("applyCatalog: сборка пишется с id и только пока слотов нет", async () => {
  const calls = [];
  const types = fakeModel([]);
  types.updateOne = async (filter, change) => {
    calls.push([filter, change]);
    return {};
  };
  const models = {
    AttributeGroup: fakeModel([]),
    DeviceType: types,
    DeviceAttribute: fakeModel([]),
    DeviceTypeAttribute: fakeModel([]),
  };
  const lines = [];
  const result = await applyCatalog(withAssembly(pcAssembly), { log: (l) => lines.push(l), models });
  assert.equal(result.updated.typeAssembly, 1);
  assert.ok(lines.some((line) => /1 types got an assembly/.test(line)));
  const id = (name) => types.rows.find((row) => row.name === name)._id;
  const cores = models.DeviceAttribute.rows.find((row) => row.code === "cores_total")._id;
  const power = models.DeviceAttribute.rows.find((row) => row.code === "psu_power")._id;
  assert.deepEqual(calls, [
    [
      {
        _id: id("Системный блок"),
        $or: [{ "assembly.slots": { $exists: false } }, { "assembly.slots": { $size: 0 } }],
      },
      {
        $set: {
          "assembly.enabled": true,
          "assembly.slots": [
            { typeId: id("Процессор"), required: true, multiple: false },
            { typeId: id("Блок питания"), required: true, multiple: false },
          ],
          "assembly.keySpecs": [
            { typeId: id("Процессор"), source: "model", attributeId: null, aggregate: "first" },
            { typeId: id("Процессор"), source: "attribute", attributeId: cores, aggregate: "sum" },
            { typeId: id("Блок питания"), source: "attribute", attributeId: power, aggregate: "list" },
          ],
        },
      },
    ],
  ]);
});

// Санитар второго сида: на базе после первого ничего не создаёт и не правит,
// только ставит сборку «Системному блоку».
test("второй сид (сборка системного блока): после первого — только typeAssembly, без предупреждений", () => {
  const first = require("../../scripts/seeds/2026-10-19-inventoryCatalog");
  const second = require("../../scripts/seeds/2026-10-19-systemUnitAssembly");
  const afterFirst = materialize(planCatalog(first.catalog, empty()), empty());

  const plan = planCatalog(second.catalog, afterFirst, { pickUpOnly: true });
  assert.deepEqual(plan.warnings, []);
  for (const list of Object.values(plan.create)) assert.deepEqual(list, []);
  assert.deepEqual(plan.update.attributeOptions, []);
  assert.deepEqual(plan.update.linkGroups, []);
  assert.deepEqual(plan.update.typeFlags, []);
  assert.equal(plan.update.typeAssembly.length, 1);

  const [entry] = plan.update.typeAssembly;
  const pc = afterFirst.types.find((t) => t.name === "Системный блок");
  assert.equal(entry._id, pc._id);
  const typeName = (key) => first.catalog.types.find((t) => t.key === key).name;
  const attrName = (key) => first.catalog.attributes.find((a) => a.key === key).name;
  assert.equal(entry.assembly.enabled, true);
  assert.deepEqual(
    entry.assembly.slots.map((s) => [typeName(s.typeKey), s.required, s.multiple]),
    [
      ["Процессор", true, false],
      ["Материнская плата", true, false],
      ["Оперативная память", true, true],
      ["Накопитель", true, true],
      ["Блок питания", true, false],
      ["Корпус", true, false],
      ["Видеокарта", false, false],
      ["Охлаждение", false, false],
      ["Wi-Fi адаптер", false, false],
    ],
  );
  assert.deepEqual(
    entry.assembly.keySpecs.map((s) => [
      typeName(s.typeKey),
      s.source,
      s.attrKey && attrName(s.attrKey),
      s.aggregate,
    ]),
    [
      ["Процессор", "model", null, "first"],
      ["Оперативная память", "attribute", "Объём модуля", "sum"],
      ["Оперативная память", "attribute", "Тип памяти", "first"],
      ["Накопитель", "attribute", "Объём накопителя", "sum"],
      ["Накопитель", "attribute", "Тип накопителя", "list"],
      ["Видеокарта", "model", null, "first"],
    ],
  );

  // И сам по себе повторный план второго сида пуст
  const again = planCatalog(second.catalog, materialize(plan, afterFirst), { pickUpOnly: true });
  isEmptyPlan(again);
  assert.deepEqual(again.warnings, []);
});

// --- pickUpOnly: только подхват ---------------------------------------------

test("pickUpOnly: на пустой базе ничего не создаёт, всё ненайденное — в предупреждениях", () => {
  const plan = planCatalog(withAssembly(pcAssembly), empty(), { pickUpOnly: true });
  isEmptyPlan(plan);
  assert.ok(plan.warnings.some((w) => /тип «Системный блок» не найден/.test(w)));
  assert.ok(plan.warnings.some((w) => /атрибут «Сокет» не найден/.test(w)));
});

test("pickUpOnly: переименованный и удалённый атрибут, тип не комплектующая — ничего не создаётся, зависящее выпадает", () => {
  const existing = materialize(planCatalog(catalog, empty()), empty());
  existing.types.push({ _id: "t-pc", name: "Системный блок", isComponent: false });
  // «Мощность» переименована владельцем, «Общее количество ядер» удалено вместе со связками
  existing.attributes.find((a) => a.code === "psu_power").name = "Мощность БП";
  existing.attributes.find((a) => a.code === "psu_power").code = "psu_watts";
  const cores = existing.attributes.find((a) => a.code === "cores_total")._id;
  existing.attributes = existing.attributes.filter((a) => a._id !== cores);
  existing.links = existing.links.filter((l) => l.attributeId !== cores);
  // Блок питания снят с комплектующих — флаг сид при подхвате не ставит
  existing.types.find((t) => t.name === "Блок питания").isComponent = false;
  // Связке без группы группу тоже не дописывает
  existing.links.forEach((l) => (l.groupId = null));

  const plan = planCatalog(withAssembly(pcAssembly), existing, { pickUpOnly: true });
  for (const list of Object.values(plan.create)) assert.deepEqual(list, []);
  assert.deepEqual(plan.update.attributeOptions, []);
  assert.deepEqual(plan.update.linkGroups, []);
  assert.deepEqual(plan.update.typeFlags, []);
  assert.ok(plan.warnings.some((w) => /атрибут «Мощность» не найден/.test(w)), plan.warnings.join("\n"));
  assert.ok(plan.warnings.some((w) => /атрибут «Общее количество ядер» не найден/.test(w)));
  assert.ok(plan.warnings.some((w) => /тип psu не комплектующая/.test(w)));
  assert.deepEqual(plan.update.typeAssembly, [
    {
      _id: "t-pc",
      typeKey: "pc",
      assembly: {
        enabled: true,
        slots: [{ typeKey: "cpu", required: true, multiple: false }],
        keySpecs: [{ typeKey: "cpu", source: "model", attrKey: null, aggregate: "first" }],
      },
    },
  ]);
});

test("pickUpOnly: связка атрибута с типом удалена — ключевая характеристика выпадает", () => {
  const existing = materialize(planCatalog(catalog, empty()), empty());
  existing.types.push({ _id: "t-pc", name: "Системный блок", isComponent: false });
  const cpu = existing.types.find((t) => t.name === "Процессор")._id;
  const cores = existing.attributes.find((a) => a.code === "cores_total")._id;
  existing.links = existing.links.filter((l) => !(l.deviceTypeId === cpu && l.attributeId === cores));
  const plan = planCatalog(withAssembly(pcAssembly), existing, { pickUpOnly: true });
  for (const list of Object.values(plan.create)) assert.deepEqual(list, []);
  assert.ok(plan.warnings.some((w) => /нет связки с атрибутом «Общее количество ядер»/.test(w)));
  assert.deepEqual(
    plan.update.typeAssembly[0].assembly.keySpecs.map((s) => s.attrKey),
    [null, "psuPower"],
  );
});

test("pickUpOnly: собираемый тип не найден — ничего не пишется", async () => {
  const existing = materialize(planCatalog(catalog, empty()), empty());
  const plan = planCatalog(withAssembly(pcAssembly), existing, { pickUpOnly: true });
  isEmptyPlan(plan);
  assert.deepEqual(plan.warnings, ["подхват: тип «Системный блок» не найден"]);

  const calls = [];
  const types = fakeModel(existing.types);
  types.updateOne = async (...args) => calls.push(args);
  const models = {
    AttributeGroup: fakeModel(existing.groups),
    DeviceType: types,
    DeviceAttribute: fakeModel(existing.attributes),
    DeviceTypeAttribute: fakeModel(existing.links),
  };
  const result = await applyCatalog(withAssembly(pcAssembly), { models, pickUpOnly: true });
  assert.deepEqual(result.created, { groups: 0, types: 0, attributes: 0, links: 0 });
  assert.deepEqual(result.updated, { attributeOptions: 0, linkGroups: 0, typeFlags: 0, typeAssembly: 0 });
  assert.deepEqual(calls, []);
});

test("второй сид через applyCatalog: на базе после первого ставит только сборку", async () => {
  const first = require("../../scripts/seeds/2026-10-19-inventoryCatalog");
  const second = require("../../scripts/seeds/2026-10-19-systemUnitAssembly");
  const afterFirst = materialize(planCatalog(first.catalog, empty()), empty());
  const calls = [];
  const types = fakeModel(afterFirst.types);
  types.updateOne = async (...args) => calls.push(args);
  const models = {
    AttributeGroup: fakeModel(afterFirst.groups),
    DeviceType: types,
    DeviceAttribute: fakeModel(afterFirst.attributes),
    DeviceTypeAttribute: fakeModel(afterFirst.links),
  };
  const result = await applyCatalog(second.catalog, { models, pickUpOnly: true });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.created, { groups: 0, types: 0, attributes: 0, links: 0 });
  assert.equal(result.updated.typeAssembly, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].$set["assembly.slots"].length, 9);
});
