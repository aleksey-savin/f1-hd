// node --test services/inventory/catalogOps.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mongoose = require("mongoose");
// Базы нет: забытая подмена падает сразу, а не висит в буфере
mongoose.set("bufferCommands", false);

const stubModule = (path, exportsValue) => {
  const resolved = require.resolve(path);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exportsValue;
  require.cache[resolved] = stub;
};

const CPU = "aaaaaaaaaaaaaaaaaaaaaaa1";
const TYPE = "eeeeeeeeeeeeeeeeeeeeeee1";
const VENDOR = "fffffffffffffffffffffff1";
const MODEL = "bbbbbbbbbbbbbbbbbbbbbbb1";
const MODEL2 = "bbbbbbbbbbbbbbbbbbbbbbb2";
const ATTR_RAM = "cccccccccccccccccccccc01";
const ATTR_DDR = "cccccccccccccccccccccc02";
const ATTR_FREE = "cccccccccccccccccccccc03";
const ATTR_IP = "cccccccccccccccccccccc04";
const USER = "333333333333333333333333";

// Сборочная часть (слоты и модели) — из deviceBuild; её у себя не проверяем
const build = require("@/controllers/inventory/deviceBuild");
const { AppError } = require("@/middleware/errorHandling");
let assemblySlots;
let typeActive = true;
stubModule("@/controllers/inventory/deviceBuild", {
  ...build,
  loadAssemblyType: async (id) =>
    id === TYPE
      ? { deviceType: { _id: TYPE, name: "Системный блок", isActive: typeActive }, slots: assemblySlots }
      : { error: new AppError("Тип устройства не найден", 404) },
  // buildFields из контроллера держит resolveParts внутри; здесь — тот же порядок
  // проверок с подменённой проверкой ссылок (базы нет)
  buildFields: async (body, slots) => {
    const name = String(body?.name ?? "").trim();
    if (!name) return { error: new AppError("Укажите название сборки", 400) };
    const parsed = build.parseBuildParts(body?.parts, slots);
    if (parsed.error) return { error: new AppError(parsed.error, 400) };
    const notes = body?.notes ? String(body.notes).trim() : undefined;
    return { name, notes, parts: parsed.parts };
  },
});

const Vendor = require("@/models/inventory/vendor");
const Supplier = require("@/models/inventory/supplier");
const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceType = require("@/models/inventory/deviceType");
const DeviceAttribute = require("@/models/inventory/deviceAttribute");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const catalogSeed = require("./catalogSeed");
const {
  validateCatalog,
  checkCatalogPatch,
  applyCatalogPatch,
  createVendor,
  checkVendor,
  createSupplier,
  checkSupplier,
  createModel,
  checkModel,
  createConfiguration,
  checkConfiguration,
  createBuild,
  checkBuild,
} = require("./catalogOps");

const chain = (value) => {
  const promise = Promise.resolve(value);
  const q = Object.assign(promise, {
    select: () => q,
    populate: () => q,
    sort: () => q,
    lean: () => q,
  });
  return q;
};

const originals = {};
const stubs = [
  [Vendor, "findOne"],
  [Supplier, "findOne"],
  [DeviceModel, "findOne"],
  [DeviceModel, "findById"],
  [DeviceModel, "find"],
  [DeviceType, "findById"],
  [Vendor, "findById"],
  [DeviceAttribute, "find"],
  [DeviceTypeAttribute, "find"],
  [DeviceConfiguration, "find"],
];
let saved;
let db;

test.beforeEach(() => {
  saved = [];
  for (const [model, name] of stubs) originals[`${model.modelName}.${name}`] = model[name];
  originals.save = mongoose.Model.prototype.save;
  mongoose.Model.prototype.save = async function save() {
    saved.push(this);
    return this;
  };
  db = {
    vendor: { _id: VENDOR, name: "HP" },
    type: { _id: TYPE, name: "Ноутбук" },
    model: { _id: MODEL, name: "ProBook 450 G9", deviceTypeId: TYPE, vendorId: VENDOR, deletedAt: null },
    attrs: [
      { _id: ATTR_RAM, code: "ram_size", name: "Объём ОЗУ", valueType: "number", unit: "ГБ", options: [] },
      {
        _id: ATTR_DDR, code: "ram_type", name: "Тип ОЗУ", valueType: "select",
        options: [{ value: "DDR4", label: "DDR4" }, { value: "DDR5", label: "DDR5" }],
      },
      { _id: ATTR_FREE, code: "free_attr", name: "Чужой", valueType: "string", options: [] },
      { _id: ATTR_IP, code: "ip_address", name: "IP-адрес", valueType: "string", scope: "device", options: [] },
    ],
    // Связаны с типом модели первые два и атрибут устройства
    links: [{ attributeId: ATTR_RAM }, { attributeId: ATTR_DDR }, { attributeId: ATTR_IP }],
  };
  assemblySlots = [{ typeId: CPU, typeName: "Процессор", required: false, multiple: true }];
  Vendor.findOne = async () => null;
  Supplier.findOne = async () => null;
  DeviceModel.findOne = async () => null;
  DeviceModel.findById = (id) => chain(String(id) === MODEL ? db.model : null);
  DeviceModel.find = () => chain([{ _id: MODEL, name: "ProBook 450 G9", vendorId: { name: "HP" } }]);
  DeviceType.findById = (id) => chain(String(id) === TYPE ? db.type : null);
  Vendor.findById = (id) => chain(String(id) === VENDOR ? db.vendor : null);
  DeviceAttribute.find = (filter) =>
    chain(db.attrs.filter((a) => (filter.code ? filter.code.$in.includes(a.code) : true)));
  DeviceTypeAttribute.find = () => chain(db.links);
  // Живые конфигурации модели; по умолчанию нет ни одной (модель старше миграции)
  db.configs = [];
  DeviceConfiguration.find = () => chain(db.configs);
});

test.afterEach(() => {
  for (const [model, name] of stubs) model[name] = originals[`${model.modelName}.${name}`];
  mongoose.Model.prototype.save = originals.save;
});

// --- вендор и поставщик --------------------------------------------------------

test("createVendor: создаёт с createdBy/updatedBy, check — без записи", async () => {
  const check = await checkVendor({ name: "Kingston" }, { userId: USER });
  assert.deepEqual(check, { ok: true, text: "Новый вендор «Kingston»" });
  assert.equal(saved.length, 0);
  const created = await createVendor({ name: "Kingston" }, { userId: USER });
  assert.equal(created.ok, true);
  assert.equal(String(saved[0]._id), String(created.id));
  assert.equal(String(saved[0].createdBy), USER);
  assert.equal(String(saved[0].updatedBy), USER);
});

test("createVendor: имя занято — 409 с текстом обработчика; пустое — 400", async () => {
  Vendor.findOne = async () => ({ _id: VENDOR });
  const dup = await createVendor({ name: "HP" }, { userId: USER });
  assert.deepEqual(dup, { ok: false, status: 409, message: 'Vendor with name "HP" already exists' });
  assert.equal((await checkVendor({ name: "HP" }, { userId: USER })).status, 409);
  const empty = await createVendor({ name: "  " }, { userId: USER });
  assert.equal(empty.status, 400);
  assert.equal(saved.length, 0);
});

const HIDDEN_NAME = "имя занято скрытой записью «HP» — верните её (isActive) или выберите другое имя";

test("скрытая запись: создание вендора и поставщика с тем же именем — понятный отказ", async () => {
  Vendor.findOne = async () => ({ _id: VENDOR, name: "HP", isActive: false });
  const dup = await createVendor({ name: "HP" }, { userId: USER });
  assert.deepEqual(dup, { ok: false, status: 409, message: HIDDEN_NAME });
  assert.equal((await checkVendor({ name: "HP" }, { userId: USER })).message, HIDDEN_NAME);
  Supplier.findOne = async () => ({ _id: "x", name: "HP", isActive: false });
  assert.deepEqual(await createSupplier({ name: "HP" }, { userId: USER }), {
    ok: false,
    status: 409,
    message: HIDDEN_NAME,
  });
  assert.equal(saved.length, 0);
});

test("createModel: скрытый вендор или тип — отказ", async () => {
  const args = { deviceTypeId: TYPE, vendorId: VENDOR, name: "X" };
  db.vendor.isActive = false;
  assert.deepEqual(await createModel(args, { userId: USER }), {
    ok: false,
    status: 400,
    message: "Вендор «HP» скрыт",
  });
  db.vendor.isActive = true;
  db.type.isActive = false;
  assert.deepEqual(await createModel(args, { userId: USER }), {
    ok: false,
    status: 400,
    message: "Тип «Ноутбук» скрыт",
  });
  assert.equal(saved.length, 0);
});

test("createSupplier: поля сохраняются, дубль — 409, текст с ИНН", async () => {
  const created = await createSupplier(
    { name: "ООО Ромашка", inn: "7701", kpp: "770101", website: "romashka.ru", notes: "договор 5" },
    { userId: USER },
  );
  assert.equal(created.ok, true);
  assert.equal(saved[0].inn, "7701");
  assert.equal(saved[0].notes, "договор 5");
  assert.equal(String(saved[0].createdBy), USER);
  const check = await checkSupplier({ name: "ООО Ромашка", inn: "7701" }, { userId: USER });
  assert.equal(check.text, "Новый поставщик «ООО Ромашка» (ИНН 7701)");
  Supplier.findOne = async () => ({ _id: "x" });
  const dup = await createSupplier({ name: "ООО Ромашка" }, { userId: USER });
  assert.deepEqual(dup, { ok: false, status: 409, message: "Поставщик «ООО Ромашка» уже есть в справочнике" });
});

// --- модель --------------------------------------------------------------------

test("createModel: текст называет вендора, модель и тип; запись с автором", async () => {
  const args = { deviceTypeId: TYPE, vendorId: VENDOR, name: "ProBook 450 G9", notes: "n" };
  const check = await checkModel(args, { userId: USER });
  assert.deepEqual(check, { ok: true, text: "Новая модель HP ProBook 450 G9 (Ноутбук)" });
  assert.equal(saved.length, 0);
  const created = await createModel(args, { userId: USER });
  assert.equal(created.ok, true);
  assert.equal(String(saved[0].vendorId), VENDOR);
  assert.equal(String(saved[0].updatedBy), USER);
  assert.equal(saved[0].notes, "n");
  // Модель живёт с конфигурацией с первого дня: пустая, той же модели
  assert.equal(saved.length, 2);
  assert.equal(saved[1].constructor.modelName, "DeviceConfiguration");
  assert.equal(String(saved[1].deviceModelId), String(saved[0]._id));
  assert.deepEqual(saved[1].values.toObject(), []);
});

test("createModel: неизвестный вендор или тип — 400, имя занято — 409", async () => {
  const noVendor = await createModel(
    { deviceTypeId: TYPE, vendorId: "fffffffffffffffffffffff9", name: "X" },
    { userId: USER },
  );
  assert.deepEqual(noVendor, { ok: false, status: 400, message: "Вендор не найден" });
  const noType = await createModel(
    { deviceTypeId: "eeeeeeeeeeeeeeeeeeeeeee9", vendorId: VENDOR, name: "X" },
    { userId: USER },
  );
  assert.deepEqual(noType, { ok: false, status: 400, message: "Тип устройства не найден" });
  const badId = await createModel({ deviceTypeId: "zz", vendorId: VENDOR, name: "X" }, { userId: USER });
  assert.equal(badId.status, 400);
  DeviceModel.findOne = async () => ({ _id: MODEL });
  const dup = await checkModel({ deviceTypeId: TYPE, vendorId: VENDOR, name: "ProBook 450 G9" }, { userId: USER });
  assert.deepEqual(
    { ok: dup.ok, status: dup.status, message: dup.message },
    { ok: false, status: 409, message: 'Device model with name "ProBook 450 G9" already exists' },
  );
  assert.equal(saved.length, 0);
});

// --- конфигурация --------------------------------------------------------------

const config = (values, extra = {}) => ({
  deviceModelId: MODEL,
  name: "16 ГБ / DDR5",
  description: "для офиса",
  values,
  ...extra,
});

test("createConfiguration: значения по коду, имя и описание сохраняются, текст человеческий", async () => {
  const args = config([{ attribute: "ram_size", value: "16" }, { attribute: "ram_type", value: "DDR5" }]);
  const check = await checkConfiguration(args, { userId: USER });
  assert.deepEqual(check, {
    ok: true,
    text: "Новая конфигурация «16 ГБ / DDR5» для HP ProBook 450 G9: Объём ОЗУ 16 ГБ, Тип ОЗУ DDR5",
  });
  assert.equal(saved.length, 0);
  const created = await createConfiguration(args, { userId: USER });
  assert.equal(created.ok, true);
  assert.equal(saved[0].name, "16 ГБ / DDR5");
  assert.equal(saved[0].description, "для офиса");
  assert.equal(String(saved[0].createdBy), USER);
  assert.deepEqual(
    saved[0].values.map((v) => [String(v.attributeId), v.value]),
    [[ATTR_RAM, "16"], [ATTR_DDR, "DDR5"]],
  );
});

test("createConfiguration: атрибут не связан с типом модели — 400", async () => {
  const result = await createConfiguration(config([{ attribute: "free_attr", value: "x" }]), { userId: USER });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.message, "Атрибут «Чужой» не относится к типу «Ноутбук»");
  assert.equal(saved.length, 0);
});

test("createConfiguration: атрибут уровня устройства — 400, даже если связан с типом", async () => {
  const result = await createConfiguration(config([{ attribute: "ip_address", value: "10.0.0.1" }]), { userId: USER });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.message, "Атрибут «IP-адрес» задаётся у каждого устройства, а не у модели");
  assert.equal(saved.length, 0);
});

test("createConfiguration: select вне вариантов, число-не-число, неизвестный код, повтор — 400", async () => {
  const badSelect = await createConfiguration(config([{ attribute: "ram_type", value: "DDR3" }]), { userId: USER });
  assert.equal(badSelect.status, 400);
  assert.equal(badSelect.message, "Значение «DDR3» не подходит атрибуту «Тип ОЗУ»");
  const badNumber = await checkConfiguration(config([{ attribute: "ram_size", value: "много" }]), { userId: USER });
  assert.equal(badNumber.status, 400);
  const unknown = await checkConfiguration(config([{ attribute: "nope", value: "1" }]), { userId: USER });
  assert.equal(unknown.message, "Атрибут «nope» не найден");
  const twice = await checkConfiguration(
    config([{ attribute: "ram_size", value: "8" }, { attribute: "ram_size", value: "16" }]),
    { userId: USER },
  );
  assert.equal(twice.status, 400);
  assert.equal(saved.length, 0);
});

test("createConfiguration: модель не найдена — 404, имя обязательно — 400", async () => {
  const noModel = await createConfiguration(config([], { deviceModelId: MODEL2 }), { userId: USER });
  assert.equal(noModel.status, 404);
  const noName = await createConfiguration(config([], { name: " " }), { userId: USER });
  assert.equal(noName.status, 400);
});

test("createConfiguration: единственная пустая вне режима нескольких — заполняется, новой нет", async () => {
  // Каждый вызов читает базу заново — у проверки и записи свои документы
  db.configs = [new DeviceConfiguration({ deviceModelId: MODEL, values: [] })];
  const args = config([{ attribute: "ram_size", value: "16" }]);
  const check = await checkConfiguration(args, { userId: USER });
  const existing = new DeviceConfiguration({ deviceModelId: MODEL, values: [] });
  db.configs = [existing];
  assert.equal(check.text, "Характеристики модели HP ProBook 450 G9: Объём ОЗУ 16 ГБ");
  assert.equal(saved.length, 0);
  const created = await createConfiguration(args, { userId: USER });
  assert.equal(created.ok, true);
  assert.equal(String(created.id), String(existing._id));
  assert.equal(saved.length, 1);
  assert.equal(saved[0], existing);
  assert.equal(existing.name, "16 ГБ / DDR5");
  assert.equal(existing.description, "для офиса");
  assert.equal(String(existing.updatedBy), USER);
  assert.deepEqual(existing.values.map((v) => [String(v.attributeId), v.value]), [[ATTR_RAM, "16"]]);
});

test("createConfiguration: единственная заполнена — новая, у модели включается режим нескольких", async () => {
  db.configs = [
    new DeviceConfiguration({ deviceModelId: MODEL, values: [{ attributeId: ATTR_RAM, value: "8" }] }),
  ];
  const created = await createConfiguration(config([{ attribute: "ram_size", value: "16" }]), {
    userId: USER,
  });
  assert.equal(created.ok, true);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].constructor.modelName, "DeviceConfiguration");
  assert.equal(String(saved[0]._id), String(created.id));
  assert.equal(saved[1].constructor.modelName, "DeviceModel");
  assert.equal(String(saved[1]._id), MODEL);
  assert.equal(saved[1].multiConfig, true);
});

test("createConfiguration: в режиме нескольких модель не трогается", async () => {
  db.model = { ...db.model, multiConfig: true };
  db.configs = [new DeviceConfiguration({ deviceModelId: MODEL, values: [] })];
  const created = await createConfiguration(config([{ attribute: "ram_size", value: "16" }]), {
    userId: USER,
  });
  assert.equal(created.ok, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].constructor.modelName, "DeviceConfiguration");
});

test("createConfiguration: у модели конфигураций нет — одна новая, модель не сохраняется", async () => {
  const created = await createConfiguration(config([{ attribute: "ram_size", value: "16" }]), {
    userId: USER,
  });
  assert.equal(created.ok, true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].constructor.modelName, "DeviceConfiguration");
});

test("checkConfiguration: ни в одном режиме ничего не сохраняет", async () => {
  const args = config([{ attribute: "ram_size", value: "16" }]);
  db.configs = [new DeviceConfiguration({ deviceModelId: MODEL, values: [] })];
  assert.equal((await checkConfiguration(args, { userId: USER })).ok, true);
  db.configs = [
    new DeviceConfiguration({ deviceModelId: MODEL, values: [{ attributeId: ATTR_RAM, value: "8" }] }),
  ];
  assert.equal((await checkConfiguration(args, { userId: USER })).ok, true);
  assert.equal(saved.length, 0);
});

// --- сборка --------------------------------------------------------------------

test("createBuild: слоты и детали разобраны общими функциями, сохранены с автором", async () => {
  const args = {
    deviceTypeId: TYPE,
    name: "Офисный ПК",
    notes: "n",
    parts: [{ typeId: CPU, deviceModelId: MODEL, quantity: 2 }],
  };
  const check = await checkBuild(args, { userId: USER });
  assert.deepEqual(check, { ok: true, text: "Новая сборка «Офисный ПК» (Системный блок): HP ProBook 450 G9 ×2" });
  assert.equal(saved.length, 0);
  const created = await createBuild(args, { userId: USER });
  assert.equal(created.ok, true);
  assert.equal(saved[0].name, "Офисный ПК");
  assert.equal(String(saved[0].deviceTypeId), TYPE);
  assert.equal(String(saved[0].createdBy), USER);
  assert.equal(saved[0].parts[0].quantity, 2);
});

test("createBuild: скрытый тип — отказ", async () => {
  typeActive = false;
  try {
    const args = { deviceTypeId: TYPE, name: "X", parts: [] };
    const expected = { ok: false, status: 400, message: "Тип «Системный блок» скрыт" };
    assert.deepEqual(await createBuild(args, { userId: USER }), expected);
    assert.equal((await checkBuild(args, { userId: USER })).message, expected.message);
  } finally {
    typeActive = true;
  }
  assert.equal(saved.length, 0);
});

test("createBuild: тип без слотов, деталь вне слотов, неизвестный тип, нет названия — 400/404", async () => {
  assemblySlots = [];
  const noSlots = await createBuild({ deviceTypeId: TYPE, name: "X", parts: [] }, { userId: USER });
  assert.deepEqual(noSlots, { ok: false, status: 400, message: "У типа не заданы комплектующие" });
  assemblySlots = [{ typeId: CPU, typeName: "Процессор", required: false, multiple: true }];
  const wrong = await createBuild(
    { deviceTypeId: TYPE, name: "X", parts: [{ typeId: "dddddddddddddddddddddddd", deviceModelId: MODEL }] },
    { userId: USER },
  );
  assert.deepEqual(wrong, { ok: false, status: 400, message: "Деталь не соответствует слотам типа" });
  const noType = await createBuild({ deviceTypeId: "eeeeeeeeeeeeeeeeeeeeeee9", name: "X", parts: [] }, { userId: USER });
  assert.equal(noType.status, 404);
  const noName = await createBuild({ deviceTypeId: TYPE, name: "", parts: [] }, { userId: USER });
  assert.equal(noName.status, 400);
  assert.equal(saved.length, 0);
});

// --- каталог -------------------------------------------------------------------

const miniCatalog = {
  groups: [],
  attributes: [{ key: "a", code: "ram_size", name: "Объём ОЗУ", valueType: "number" }],
  types: [{ key: "t", name: "Ноутбук", attributes: [{ attr: "a", group: null }] }],
};

test("checkCatalogPatch: строки describePlan без записей; apply возвращает ids", async (t) => {
  const existing = { groups: [], types: [], attributes: [], links: [] };
  t.mock.method(catalogSeed, "loadExisting", async () => existing);
  const check = await checkCatalogPatch(miniCatalog);
  assert.equal(check.ok, true);
  assert.deepEqual(check.lines, [
    "Новый тип «Ноутбук» (комплектующая: нет)",
    "Новый атрибут «Объём ОЗУ» (число)",
    "Тип «Ноутбук»: атрибуты Объём ОЗУ",
  ]);
  assert.equal(check.text, check.lines.join("\n"));
  const calls = [];
  t.mock.method(catalogSeed, "applyCatalog", async (catalog, options) => {
    calls.push(options);
    return { created: { types: 1 }, updated: {}, warnings: [], ids: { groups: {}, types: { t: "T1" }, attributes: { a: "A1" } } };
  });
  const applied = await applyCatalogPatch(miniCatalog, { userId: USER });
  assert.equal(applied.ok, true);
  assert.equal(applied.ids.types.t, "T1");
  assert.equal(calls[0].userId, USER);
});

test("applyCatalogPatch: сбой записи — 500 с сообщением, без выброса", async (t) => {
  t.mock.method(catalogSeed, "applyCatalog", async () => {
    throw new Error("insert failed");
  });
  const result = await applyCatalogPatch(miniCatalog, { userId: USER });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  t.mock.method(catalogSeed, "applyCatalog", async () => {
    throw Object.assign(new Error("update failed"), { optionsPushed: true });
  });
  const pushed = await applyCatalogPatch(miniCatalog, { userId: USER });
  assert.match(pushed.message, /часть вариантов могла быть добавлена/);
});

test("catalog: всё уже есть — 400 «Каталог не меняется» при предложении; при применении ok с подхваченными ids", async (t) => {
  const existing = {
    groups: [],
    types: [{ _id: "t1", name: "Ноутбук", isComponent: false }],
    attributes: [{ _id: "a1", code: "ram_size", name: "Объём ОЗУ", valueType: "number" }],
    links: [{ _id: "l1", deviceTypeId: "t1", attributeId: "a1", groupId: null, order: 0 }],
  };
  t.mock.method(catalogSeed, "loadExisting", async () => existing);
  const check = await checkCatalogPatch(miniCatalog);
  assert.deepEqual(
    { ok: check.ok, status: check.status, message: check.message },
    { ok: false, status: 400, message: "Каталог не меняется — операция не нужна" },
  );
  // повторная проверка при применении: «всё уже есть» не отказ
  const recheck = await checkCatalogPatch(miniCatalog, { allowNoop: true });
  assert.equal(recheck.ok, true);
  const ids = { groups: {}, types: { t: "t1" }, attributes: { a: "a1" } };
  t.mock.method(catalogSeed, "applyCatalog", async () => ({ created: { types: 0 }, updated: { typeFlags: 0 }, warnings: [], ids }));
  const applied = await applyCatalogPatch(miniCatalog, { userId: USER });
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.ids, ids);
});

test("checkCatalogPatch: неизвестный valueType не проходит уже в check (enum модели)", async (t) => {
  t.mock.method(catalogSeed, "loadExisting", async () => ({ groups: [], types: [], attributes: [], links: [] }));
  // Отказывает validateCatalog; validatePlanned (validate документов) — вторая линия с тем же enum
  const result = await checkCatalogPatch({
    ...miniCatalog,
    attributes: [{ ...miniCatalog.attributes[0], valueType: "datetime" }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

// --- validateCatalog -----------------------------------------------------------

const refused = (catalog) => {
  const result = validateCatalog(catalog);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  return result.message;
};

test("validateCatalog: корректный каталог и пустые списки проходят", () => {
  assert.deepEqual(validateCatalog(miniCatalog), { ok: true });
  assert.deepEqual(validateCatalog({}), { ok: true });
});

test("validateCatalog: все причины сразу, русский текст", () => {
  const message = refused({
    groups: "no",
    types: [{ key: "T", name: "" }, null],
    attributes: [
      { key: "a", code: "BAD", name: "X", valueType: "datetime" },
      { key: "a", code: "ok", name: "Y", valueType: "select", options: [] },
    ],
  });
  for (const part of ["groups должен быть массивом", "key должен быть вида", "должен быть объектом", "code должен быть вида", "valueType", "key «a» повторяется", "нужен хотя бы один вариант"]) {
    assert.ok(message.includes(part), part);
  }
  assert.ok(message.startsWith("Каталог не принят: "));
});

test("validateCatalog: зарезервированные key, лимиты, неизвестные ссылки", () => {
  assert.match(refused({ groups: [{ key: "constructor", name: "G" }] }), /зарезервирован/);
  assert.match(refused({ types: [{ key: "__proto__", name: "T" }] }), /key/);
  assert.match(refused({ groups: Array.from({ length: 31 }, (_, i) => ({ key: `g${i}`, name: "G" })) }), /groups: не больше 30/);
  const withRefs = refused({
    attributes: [{ key: "a", code: "c", name: "A", valueType: "string" }],
    types: [{ key: "t", name: "T", attributes: [{ attr: "zz", group: "gg" }, { attr: "a", required: "yes" }] }],
  });
  assert.match(withRefs, /attr «zz» не среди атрибутов/);
  assert.match(withRefs, /group «gg» не среди групп/);
  assert.match(withRefs, /required/);
});

test("validateCatalog: варианты, unit, flags, сборка", () => {
  const message = refused({
    attributes: [{ key: "a", code: "c", name: "A", valueType: "select", unit: "x".repeat(21), options: [{ value: "" }, 5] }],
    types: [
      {
        key: "t",
        name: "T",
        flags: { isComponent: "yes", other: true },
        assembly: {
          slots: [{ type: "nope" }],
          keySpecs: [{ type: "t", source: "attribute", aggregate: "avg" }],
        },
      },
    ],
  });
  for (const part of ["unit", "вариант №1", "вариант №2", "flags", "слот №1: type «nope»", "aggregate", "attr «undefined»"]) {
    assert.ok(message.includes(part), part);
  }
  // Строковые варианты и { value, label } допустимы
  assert.deepEqual(
    validateCatalog({ attributes: [{ key: "a", code: "c", name: "A", valueType: "select", options: ["x", { value: "y", label: "Y" }] }] }),
    { ok: true },
  );
});

test("validateCatalog: два назначения у типа — отказ", () => {
  const message = refused({
    types: [{ key: "t", name: "T", flags: { isComponent: true, isPeripheral: true } }],
  });
  assert.match(message, /одно назначение/);
  assert.deepEqual(
    validateCatalog({ types: [{ key: "t", name: "T", flags: { isComponent: true, isPeripheral: false } }] }),
    { ok: true },
  );
});

test("validateCatalog: перевод строки и невидимые символы в любой строке — отказ с полем", () => {
  const message = refused({
    groups: [{ key: "g", name: "Память\nНовая группа «Х»" }],
    attributes: [
      { key: "pwd", code: "pwd", name: "Пароль\nНовый атрибут «Пароль» (строка)", valueType: "string" },
      { key: "ports", code: "ports", name: "Порты", valueType: "select", unit: "шт\u2028", options: ["USB", { value: "HDMI", label: "H\u202eD" }] },
    ],
    types: [{ key: "Bad\nkey", name: "Т" }, { key: "mono", name: "Моно\u200bблок" }],
  });
  for (const part of [
    "группа «g»: «name» содержит недопустимые символы",
    "атрибут «pwd»: «name» содержит недопустимые символы",
    "атрибут «ports»: «unit» содержит недопустимые символы",
    "атрибут «ports»: «options[1].label» содержит недопустимые символы",
    "тип №1: «key» содержит недопустимые символы",
    "тип «mono»: «name» содержит недопустимые символы",
  ]) {
    assert.ok(message.includes(part), part);
  }
  // негодный key в причину не попадает
  assert.ok(!message.includes("Bad\nkey"));
});

test("checkCatalogPatch/applyCatalogPatch: кривая структура — 400 до базы, не 500", async () => {
  for (const bad of [null, "str", { types: [null] }, { attributes: [{ key: "k" }] }]) {
    const check = await checkCatalogPatch(bad);
    assert.equal(check.status, 400);
    const applied = await applyCatalogPatch(bad, { userId: USER });
    assert.equal(applied.status, 400);
  }
});

test("конфигурация: объект — 400, multiselect массивом хранится JSON, текст по подписям", async () => {
  db.attrs.push({
    _id: "cccccccccccccccccccccc04", code: "ports", name: "Порты", valueType: "multiselect",
    options: [{ value: "usb", label: "USB" }, { value: "hdmi", label: "HDMI" }],
  });
  db.links.push({ attributeId: "cccccccccccccccccccccc04" });
  const obj = await createConfiguration(config([{ attribute: "ram_size", value: { a: 1 } }]), { userId: USER });
  assert.deepEqual(obj, { ok: false, status: 400, message: "Неверное значение атрибута «Объём ОЗУ»" });
  const wrongArray = await checkConfiguration(config([{ attribute: "ram_size", value: ["1"] }]), { userId: USER });
  assert.equal(wrongArray.status, 400);
  const args = config([{ attribute: "ports", value: ["usb", "hdmi"] }]);
  const check = await checkConfiguration(args, { userId: USER });
  assert.match(check.text, /Порты USB, HDMI$/);
  await createConfiguration(args, { userId: USER });
  assert.equal(saved[0].values[0].value, JSON.stringify(["usb", "hdmi"]));
  const bad = await checkConfiguration(config([{ attribute: "ports", value: ["usb", "vga"] }]), { userId: USER });
  assert.equal(bad.status, 400);
});

// ─── Финальная правка фазы 4 ──────────────────────────────────────────────────

test("createConfiguration: скрытый атрибут по коду — отказ «Атрибут «X» скрыт»", async () => {
  db.attrs[0].isActive = false;
  const args = config([{ attribute: "ram_size", value: "16" }]);
  const expected = { ok: false, status: 400, message: "Атрибут «Объём ОЗУ» скрыт" };
  assert.deepEqual(await checkConfiguration(args, { userId: USER }), { ...expected, text: "" });
  assert.deepEqual(await createConfiguration(args, { userId: USER }), expected);
  assert.equal(saved.length, 0);
});

test("checkCatalogPatch/applyCatalogPatch: скрытое имя — отказ на пути агента", async (t) => {
  const existing = {
    groups: [],
    types: [{ _id: "t-old", name: "Ноутбук", isActive: false, isComponent: false }],
    attributes: [],
    links: [],
  };
  t.mock.method(catalogSeed, "loadExisting", async () => existing);
  const check = await checkCatalogPatch(miniCatalog);
  assert.equal(check.ok, false);
  assert.equal(check.status, 409);
  assert.match(check.message, /^имя занято скрытой записью «Ноутбук»/);
  // Запись: агентский путь просит отказ, а не предупреждение сида
  const calls = [];
  t.mock.method(catalogSeed, "applyCatalog", async (catalog, options) => {
    calls.push(options);
    return { created: {}, updated: {}, warnings: [], ids: { groups: {}, types: {}, attributes: {} } };
  });
  await applyCatalogPatch(miniCatalog, { userId: USER });
  assert.equal(calls[0].hiddenClash, "refuse");
});
