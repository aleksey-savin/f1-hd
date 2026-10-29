// node --test controllers/inventory/clientDeviceParts.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mongoose = require("mongoose");
// Базы нет: забытая подмена падает сразу, а не висит в буфере
mongoose.set("bufferCommands", false);

// models/ticket.js на верхнем уровне зовёт initCounter() — без базы это шум;
// подмена до загрузки контроллера (как в deviceScope.access.test.js)
const stubModule = (path, exportsValue) => {
  const resolved = require.resolve(path);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exportsValue;
  require.cache[resolved] = stub;
};
stubModule("@/models/ticket", { Ticket: {} });
// Рубильник Mikrotik читает Preferences — подмена до загрузки контроллера
require("@/services/mikrotik/enabled").mikrotikEnabled = async () => false;

const { planDeviceParts } = require("./clientDevice");

const CPU = "aaaaaaaaaaaaaaaaaaaaaaa1";
const RAM = "aaaaaaaaaaaaaaaaaaaaaaa2";
const SSD = "aaaaaaaaaaaaaaaaaaaaaaa3";
const GPU = "aaaaaaaaaaaaaaaaaaaaaaa4";
const M1 = "bbbbbbbbbbbbbbbbbbbbbbb1";
const M2 = "bbbbbbbbbbbbbbbbbbbbbbb2";
const M3 = "bbbbbbbbbbbbbbbbbbbbbbb3";
const C1 = "cccccccccccccccccccccc01";
const S1 = "dddddddddddddddddddddd01";

const slots = [
  { typeId: CPU, typeName: "Процессор", required: true, multiple: false },
  { typeId: RAM, typeName: "Память", required: true, multiple: true },
  { typeId: SSD, typeName: "Накопитель", required: false, multiple: true },
];

test("валидный набор: две единицы памяти в «несколько», порядок слотов", () => {
  const res = planDeviceParts(
    [
      { typeId: RAM, deviceModelId: M2, configurationId: C1, serialNumber: " A1 " },
      { typeId: CPU, deviceModelId: M1, warrantyExpirationDate: "2028-01-01" },
      { typeId: RAM, deviceModelId: M2, configurationId: C1, serialNumber: "A2" },
    ],
    slots,
  );
  assert.ifError(res.error);
  assert.equal(res.parts.length, 3);
  // Порядок слотов, внутри слота — как прислано
  assert.deepEqual(
    res.parts.map((p) => [p.typeId, p.serialNumber ?? null]),
    [
      [CPU, null],
      [RAM, "A1"],
      [RAM, "A2"],
    ],
  );
  assert.equal(res.parts[0].configurationId, null);
  assert.equal(res.parts[0].warrantyExpirationDate, "2028-01-01");
  assert.equal(res.parts[1].configurationId, C1);
  // Каждая деталь — одна единица
  assert.ok(res.parts.every((p) => p.quantity === undefined));
});

test("вторая единица в слоте без «несколько» — ошибка", () => {
  const res = planDeviceParts(
    [
      { typeId: CPU, deviceModelId: M1 },
      { typeId: CPU, deviceModelId: M3 },
      { typeId: RAM, deviceModelId: M2 },
    ],
    slots,
  );
  assert.match(res.error, /только одна деталь/);
});

test("деталь вне слотов типа — ошибка", () => {
  const res = planDeviceParts(
    [
      { typeId: CPU, deviceModelId: M1 },
      { typeId: RAM, deviceModelId: M2 },
      { typeId: GPU, deviceModelId: M3 },
    ],
    slots,
  );
  assert.match(res.error, /не соответствует слотам/);
});

test("пропущен обязательный слот — «Не заполнено: …»", () => {
  const res = planDeviceParts([{ typeId: CPU, deviceModelId: M1 }], slots);
  assert.equal(res.error, "Не заполнено: Память");
});

test("пустой список — без деталей и без проверки обязательных", () => {
  assert.deepEqual(planDeviceParts([], slots), { parts: [] });
  assert.deepEqual(planDeviceParts(undefined, slots), { parts: [] });
});

test("не массив — ошибка", () => {
  assert.ok(planDeviceParts({ typeId: CPU }, slots).error);
});

test("деталь без модели — ошибка слота", () => {
  const res = planDeviceParts(
    [{ typeId: CPU }, { typeId: RAM, deviceModelId: M2 }],
    slots,
  );
  assert.match(res.error, /Не выбрана модель для слота «Процессор»/);
});

test("закупка детали: свои дата и поставщик проходят, кривые — ошибка", () => {
  const ok = planDeviceParts(
    [
      { typeId: CPU, deviceModelId: M1, purchasedAt: "2025-03-01", supplierId: S1 },
      { typeId: RAM, deviceModelId: M2, purchasedAt: "", supplierId: "" },
    ],
    slots,
  );
  assert.ifError(ok.error);
  assert.equal(ok.parts[0].purchasedAt, "2025-03-01");
  assert.equal(ok.parts[0].supplierId, S1);
  // Пустые строки — «не задано» (закупка как у ПК)
  assert.equal(ok.parts[1].purchasedAt, undefined);
  assert.equal(ok.parts[1].supplierId, undefined);

  const badDate = planDeviceParts(
    [
      { typeId: CPU, deviceModelId: M1, warrantyExpirationDate: "не дата" },
      { typeId: RAM, deviceModelId: M2 },
    ],
    slots,
  );
  assert.match(badDate.error, /«Процессор»/);

  const badSupplier = planDeviceParts(
    [
      { typeId: CPU, deviceModelId: M1 },
      { typeId: RAM, deviceModelId: M2, supplierId: "xyz" },
    ],
    slots,
  );
  assert.match(badSupplier.error, /«Память»/);
});

// --- add: ПК с деталями на подставных моделях (без Mongo) -------------------

const ClientDevice = require("@/models/inventory/clientDevice");
const Company = require("@/models/company");
const Counter = require("@/models/inventory/counter");
const DeviceBuild = require("@/models/inventory/deviceBuild");
const DeviceType = require("@/models/inventory/deviceType");
const DeviceModel = require("@/models/inventory/deviceModel");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const controller = require("./clientDevice");

const PC = "eeeeeeeeeeeeeeeeeeeeee01";
const OTHER_TYPE = "eeeeeeeeeeeeeeeeeeeeee02";
const COMPANY = "ffffffffffffffffffffff01";
const BUILD = "abababababababababababab";

// Цепочка запроса Mongoose: populate/select/sort → lean или await
const chain = (value) => {
  const c = {
    populate: () => c,
    select: () => c,
    sort: () => c,
    lean: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return c;
};

const call = async (handler, req) => {
  let error = null;
  const res = {
    status(code) {
      res.code = code;
      return res;
    },
    json(body) {
      res.body = body;
    },
    end() {},
  };
  await handler({ userId: "66bb00000000000000000001", params: {}, ...req }, res, (e) => {
    error = e;
  });
  return { res, error };
};

const pcType = {
  _id: PC,
  name: "Системный блок",
  inventoryPrefix: "PC",
  assembly: {
    enabled: true,
    slots: [
      { typeId: { _id: CPU, name: "Процессор" }, required: true, multiple: false },
      { typeId: { _id: RAM, name: "Память" }, required: true, multiple: true },
    ],
  },
};

// Каталог: M1 — процессор, M2 — память, M3 — память (чужой тип для слота CPU)
const models = [
  { _id: M1, name: "Ryzen 5", deviceTypeId: CPU },
  { _id: M2, name: "DDR5 16", deviceTypeId: RAM },
  { _id: M3, name: "DDR5 32", deviceTypeId: RAM },
];

const stubCatalog = (t, { saveFailsAt = 0 } = {}) => {
  t.mock.method(DeviceType, "findById", (id) =>
    chain(String(id) === PC ? pcType : { _id: id, inventoryPrefix: "CMP" }),
  );
  t.mock.method(DeviceType, "find", () =>
    chain([
      { _id: CPU, name: "Процессор" },
      { _id: RAM, name: "Память" },
    ]),
  );
  t.mock.method(DeviceModel, "find", (filter) =>
    chain(models.filter((m) => filter._id.$in.includes(m._id))),
  );
  t.mock.method(DeviceConfiguration, "find", () => chain([]));
  t.mock.method(DeviceTypeAttribute, "find", () => chain([]));
  // Единственная конфигурация модели (soleConfigurationId) — здесь её нет
  t.mock.method(DeviceModel, "findOne", () => chain(null));
  t.mock.method(Company, "findById", () => chain({ _id: COMPANY }));
  t.mock.method(DeviceBuild, "exists", (filter) =>
    String(filter._id) === BUILD && String(filter.deviceTypeId) === PC
      ? { _id: BUILD }
      : null,
  );
  let seq = 0;
  t.mock.method(Counter, "getNextSequence", async () => ++seq);

  const saved = [];
  let saves = 0;
  t.mock.method(ClientDevice.prototype, "save", async function save() {
    saves += 1;
    if (saves === saveFailsAt) throw new Error("диск отвалился");
    saved.push(this);
    return this;
  });
  const deleted = [];
  t.mock.method(ClientDevice, "deleteMany", async (filter) => {
    deleted.push(...filter._id.$in.map(String));
    return { deletedCount: filter._id.$in.length };
  });
  t.mock.method(ClientDevice, "deleteOne", async (filter) => {
    deleted.push(String(filter._id));
    return { deletedCount: 1 };
  });
  return { saved, deleted };
};

const pcBody = (extra) => ({
  companyId: COMPANY,
  deviceTypeId: PC,
  status: "deployed",
  purchasedAt: "2025-01-10",
  supplierId: S1,
  ...extra,
});

test("add: ПК из сборки с деталями — детали следуют за ПК, закупка как у ПК", async (t) => {
  const { saved, deleted } = stubCatalog(t);
  const { res, error } = await call(controller.add, {
    body: pcBody({
      buildId: BUILD,
      parts: [
        { typeId: RAM, deviceModelId: M2, serialNumber: "R1" },
        { typeId: CPU, deviceModelId: M1, purchasedAt: "2024-05-05" },
        { typeId: RAM, deviceModelId: M2, serialNumber: "R2" },
      ],
    }),
  });
  assert.ifError(error);
  assert.equal(res.code, 201);
  assert.equal(saved.length, 4);
  assert.equal(deleted.length, 0);
  const [host, ...parts] = saved;
  assert.equal(String(host.buildId), BUILD);
  assert.equal(host.inventoryNumber, "PC-000001");
  assert.equal(res.body.components.length, 3);
  // Порядок слотов: процессор, затем память
  assert.deepEqual(
    parts.map((p) => String(p.deviceModelId)),
    [M1, M2, M2],
  );
  for (const part of parts) {
    assert.equal(String(part.parentDeviceId), String(host._id));
    assert.equal(String(part.companyId), COMPANY);
    assert.equal(part.status, "deployed");
    assert.equal(part.quantity, 1);
    assert.equal(part.buildId ?? null, null);
    assert.match(part.inventoryNumber, /^CMP-/);
  }
  // Своя закупка процессора — без поставщика ПК; память — закупка ПК
  assert.equal(parts[0].purchasedAt.toISOString().slice(0, 10), "2024-05-05");
  assert.equal(parts[0].supplierId, undefined);
  assert.equal(parts[1].purchasedAt.toISOString().slice(0, 10), "2025-01-10");
  assert.equal(String(parts[1].supplierId), S1);
  assert.equal(parts[1].serialNumber, "R1");
});

test("add: модель чужого типа в слоте — 400 до первой записи", async (t) => {
  const { saved } = stubCatalog(t);
  const { error } = await call(controller.add, {
    body: pcBody({
      parts: [
        { typeId: CPU, deviceModelId: M3 },
        { typeId: RAM, deviceModelId: M2 },
      ],
    }),
  });
  assert.equal(error?.statusCode, 400);
  assert.match(error.message, /не относится к типу «Процессор»/);
  assert.equal(saved.length, 0);
});

test("add: сборка другого типа — 400 до первой записи", async (t) => {
  const { saved } = stubCatalog(t);
  const { error } = await call(controller.add, {
    body: pcBody({ buildId: "abababababababababab0000", parts: [] }),
  });
  assert.equal(error?.statusCode, 400);
  assert.equal(saved.length, 0);
});

test("add: сборка у заводского устройства — 400", async (t) => {
  const { saved } = stubCatalog(t);
  t.mock.method(DeviceModel, "findById", () => chain({ _id: M1, deviceTypeId: PC }));
  const { error } = await call(controller.add, {
    body: pcBody({ deviceModelId: M1, buildId: BUILD }),
  });
  assert.equal(error?.statusCode, 400);
  assert.equal(saved.length, 0);
});

test("add: детали у типа без сборки — 400", async (t) => {
  const { saved } = stubCatalog(t);
  const { error } = await call(controller.add, {
    body: pcBody({
      deviceTypeId: OTHER_TYPE,
      parts: [{ typeId: CPU, deviceModelId: M1 }],
    }),
  });
  assert.equal(error?.statusCode, 400);
  assert.equal(saved.length, 0);
});

test("add: своя сборка типа без комплектующих — 400, ничего не записано", async (t) => {
  const { saved } = stubCatalog(t);
  const { error } = await call(controller.add, {
    body: pcBody({ deviceTypeId: OTHER_TYPE }),
  });
  assert.equal(error?.statusCode, 400);
  assert.match(error.message, /не собирается из комплектующих/);
  assert.equal(saved.length, 0);
});

test("add: деталь без модели (с родителем) у типа без сборки — как раньше", async (t) => {
  const { saved } = stubCatalog(t);
  t.mock.method(ClientDevice, "findById", () =>
    chain({ _id: "6a28ed8f6d333b3a785274ff", companyId: COMPANY }),
  );
  const { res, error } = await call(controller.add, {
    body: {
      companyId: COMPANY,
      deviceTypeId: OTHER_TYPE,
      parentDeviceId: "6a28ed8f6d333b3a785274ff",
    },
  });
  assert.ifError(error);
  assert.equal(res.code, 201);
  assert.equal(saved.length, 1);
});

test("add: пустой список деталей — ПК без деталей, как раньше", async (t) => {
  const { saved } = stubCatalog(t);
  const { res, error } = await call(controller.add, {
    body: pcBody({ parts: [] }),
  });
  assert.ifError(error);
  assert.equal(res.code, 201);
  assert.equal(saved.length, 1);
  assert.deepEqual(res.body.components, []);
});

test("add: сбой на второй детали — созданное удалено по _id, ошибка исходная", async (t) => {
  // Запись 1 — ПК, 2 — первая деталь, 3 — вторая (падает)
  const { saved, deleted } = stubCatalog(t, { saveFailsAt: 3 });
  const { error } = await call(controller.add, {
    body: pcBody({
      parts: [
        { typeId: CPU, deviceModelId: M1 },
        { typeId: RAM, deviceModelId: M2 },
        { typeId: RAM, deviceModelId: M2 },
      ],
    }),
  });
  assert.equal(error?.statusCode, 500);
  assert.equal(error.originalError?.message, "диск отвалился");
  assert.equal(saved.length, 2);
  // Сначала деталь, затем ПК
  assert.deepEqual(deleted, [String(saved[1]._id), String(saved[0]._id)]);
});

// --- update: сборка-шаблон не теряется при правке ---------------------------

const existingPc = () =>
  new ClientDevice({
    companyId: COMPANY,
    deviceTypeId: PC,
    buildId: BUILD,
    inventoryNumber: "PC-000001",
  });

test("update: правка без buildId сохраняет сборку", async (t) => {
  const { saved } = stubCatalog(t);
  const pc = existingPc();
  t.mock.method(ClientDevice, "findById", () => chain(pc));
  const { error } = await call(controller.update, {
    params: { id: String(pc._id) },
    body: { companyId: COMPANY, deviceTypeId: PC, inventoryNumber: "PC-000001" },
  });
  assert.ifError(error);
  assert.equal(saved.length, 1);
  assert.equal(String(saved[0].buildId), BUILD);
});

test("update: смена типа снимает сборку, чужая сборка — 400", async (t) => {
  const { saved } = stubCatalog(t);
  const pc = existingPc();
  t.mock.method(ClientDevice, "findById", () => chain(pc));
  const { error } = await call(controller.update, {
    params: { id: String(pc._id) },
    body: { companyId: COMPANY, deviceTypeId: OTHER_TYPE },
  });
  assert.ifError(error);
  assert.equal(saved[0].buildId, null);

  const other = existingPc();
  t.mock.method(ClientDevice, "findById", () => chain(other));
  const bad = await call(controller.update, {
    params: { id: String(other._id) },
    body: {
      companyId: COMPANY,
      deviceTypeId: PC,
      buildId: "abababababababababab0000",
    },
  });
  assert.equal(bad.error?.statusCode, 400);
  assert.equal(saved.length, 1);
});

test("update: прежняя сборка не перепроверяется (даже удалённая)", async (t) => {
  const { saved } = stubCatalog(t);
  // Сборку удалили после создания ПК — exists её уже не находит
  t.mock.method(DeviceBuild, "exists", () => null);
  const pc = existingPc();
  t.mock.method(ClientDevice, "findById", () => chain(pc));
  const { error } = await call(controller.update, {
    params: { id: String(pc._id) },
    body: { companyId: COMPANY, deviceTypeId: PC, buildId: BUILD },
  });
  assert.ifError(error);
  assert.equal(saved.length, 1);
  assert.equal(String(saved[0].buildId), BUILD);
});

// --- update детали: связь с ПК не теряется ---------------------------------

const HOST = "eeeeeeeeeeeeeeeeeeeeee99";
const existingPart = () =>
  new ClientDevice({
    companyId: COMPANY,
    deviceTypeId: CPU,
    parentDeviceId: HOST,
    inventoryNumber: "CMP-000001",
  });

test("update: правка детали без parentDeviceId сохраняет ПК, явный null снимает", async (t) => {
  const { saved } = stubCatalog(t);
  const part = existingPart();
  t.mock.method(ClientDevice, "findById", () => chain(part));
  const { error } = await call(controller.update, {
    params: { id: String(part._id) },
    body: { companyId: COMPANY, deviceTypeId: CPU, serialNumber: "S-1" },
  });
  assert.ifError(error);
  assert.equal(String(saved[0].parentDeviceId), HOST);
  assert.equal(saved[0].serialNumber, "S-1");

  const other = existingPart();
  t.mock.method(ClientDevice, "findById", () => chain(other));
  const cleared = await call(controller.update, {
    params: { id: String(other._id) },
    body: { companyId: COMPANY, deviceTypeId: CPU, parentDeviceId: null },
  });
  assert.ifError(cleared.error);
  assert.equal(saved[1].parentDeviceId ?? null, null);
});

// --- delete: ПК с деталями не удаляется ------------------------------------

test("delete: ПК с деталями — 409 со счётом, без удаления; без деталей — 204", async (t) => {
  const { deleted } = stubCatalog(t);
  const pc = existingPc();
  t.mock.method(ClientDevice, "findById", () => chain(pc));
  let filter = null;
  let count = 3;
  t.mock.method(ClientDevice, "countDocuments", async (f) => {
    filter = f;
    return count;
  });
  const busy = await call(controller.delete, { params: { id: String(pc._id) } });
  assert.equal(busy.error?.statusCode, 409);
  assert.equal(busy.error.message, "Сначала открепите детали: 3 детали");
  assert.equal(String(filter.parentDeviceId), String(pc._id));
  assert.equal(filter.deletedAt, null);
  assert.deepEqual(deleted, []);

  count = 1;
  const one = await call(controller.delete, { params: { id: String(pc._id) } });
  assert.equal(one.error.message, "Сначала открепите детали: 1 деталь");
  count = 5;
  const many = await call(controller.delete, { params: { id: String(pc._id) } });
  assert.equal(many.error.message, "Сначала открепите детали: 5 деталей");
  assert.deepEqual(deleted, []);

  count = 0;
  const free = await call(controller.delete, { params: { id: String(pc._id) } });
  assert.ifError(free.error);
  assert.equal(free.res.code, 204);
  assert.deepEqual(deleted, [String(pc._id)]);
});

// --- getOne: данные карточки ПК своей сборки ---------------------------------


test("getOne: у ПК своей сборки — assembly, build, partLinks и узкие детали", async (t) => {
  stubCatalog(t);
  const pc = new ClientDevice({
    companyId: COMPANY,
    deviceTypeId: PC,
    buildId: BUILD,
  });
  // populate(...) подменён: тип ПК раскрыт, как его отдал бы Mongo
  const doc = {
    _id: pc._id,
    deviceTypeId: { _id: PC, name: "Системный блок" },
    buildId: BUILD,
    companyId: COMPANY,
    toObject() {
      const { toObject: _toObject, ...rest } = this;
      return rest;
    },
  };
  t.mock.method(ClientDevice, "findById", () => chain(doc));
  const queries = [];
  t.mock.method(ClientDevice, "find", (filter) => {
    const q = {
      selected: null,
      select(fields) {
        q.selected = fields;
        return q;
      },
      populate: () => q,
      lean: async () => [
        { _id: "p1", deviceModelId: { _id: M1, deviceTypeId: { _id: CPU, name: "Процессор" } } },
      ],
    };
    queries.push({ filter, q });
    return q;
  });
  const buildPopulate = [];
  t.mock.method(DeviceBuild, "findOne", () => {
    const c = chain({ _id: BUILD, name: "Офисный", parts: [] });
    c.populate = (arg) => {
      buildPopulate.push(arg);
      return c;
    };
    return c;
  });
  let linkTypes = null;
  t.mock.method(DeviceTypeAttribute, "find", (filter) => {
    // Второй запрос — связки самого типа (атрибуты устройства), не деталей
    if (filter.deviceTypeId?.$in) linkTypes = filter.deviceTypeId.$in;
    return chain([]);
  });

  const { res, error } = await call(controller.getOne, {
    params: { id: String(pc._id) },
    auth: { isEndUser: false },
  });
  assert.ifError(error);
  assert.equal(res.body.assembly.enabled, true);
  assert.equal(res.body.build.name, "Офисный");
  // Детали сборки раскрыты так же, как в /device-builds/:id
  assert.deepEqual(
    buildPopulate[0]?.map((p) => p.path),
    ["parts.deviceModelId", "parts.configurationId", "parts.typeId"],
  );
  assert.deepEqual(res.body.partLinks, { [CPU]: [] });
  assert.deepEqual(linkTypes, [CPU]);
  assert.match(queries[0].q.selected, /serialNumber/);
  assert.doesNotMatch(queries[0].q.selected, /price|notes|companyId/);
});

test("getOne: у заводского устройства — без данных сборки", async (t) => {
  stubCatalog(t);
  const doc = {
    _id: "66cc00000000000000000001",
    deviceModelId: { _id: M1, name: "OptiPlex", deviceTypeId: { _id: PC } },
    companyId: COMPANY,
    toObject() {
      const { toObject: _toObject, ...rest } = this;
      return rest;
    },
  };
  t.mock.method(ClientDevice, "findById", () => chain(doc));
  t.mock.method(ClientDevice, "find", () => chain([]));
  t.mock.method(DeviceTypeAttribute, "find", () => chain([]));
  const { res, error } = await call(controller.getOne, {
    params: { id: doc._id },
    auth: { isEndUser: false },
  });
  assert.ifError(error);
  assert.equal(res.body.assembly, undefined);
  assert.equal(res.body.build, undefined);
  assert.equal(res.body.partLinks, undefined);
});

// --- update: параметры устройства сливаются с текущими ----------------------

const IP_ATTR = "cdcdcdcdcdcdcdcdcdcdcd01";
const MAC_ATTR = "cdcdcdcdcdcdcdcdcdcdcd02";
const deviceLink = (_id, code, name) => ({
  attributeId: { _id, code, name, valueType: "string", scope: "device", options: [] },
  required: false,
});

test("update: параметр, которого форма не знала, остаётся; пустой — снимается", async (t) => {
  const { saved } = stubCatalog(t);
  // Связка MAC появилась после открытия формы (синхронизация Mikrotik)
  t.mock.method(DeviceTypeAttribute, "find", () =>
    chain([deviceLink(IP_ATTR, "ip_address", "IP-адрес"), deviceLink(MAC_ATTR, "mac_address", "MAC-адрес")]),
  );
  const pc = existingPc();
  pc.attributes = [
    { attributeId: IP_ATTR, value: "10.0.0.1" },
    { attributeId: MAC_ATTR, value: "AA:BB:CC:DD:EE:FF" },
  ];
  t.mock.method(ClientDevice, "findById", () => chain(pc));
  const body = { companyId: COMPANY, deviceTypeId: PC, inventoryNumber: "PC-000001" };

  const kept = await call(controller.update, {
    params: { id: String(pc._id) },
    body: { ...body, attributes: [{ attributeId: IP_ATTR, value: "10.0.0.2" }] },
  });
  assert.ifError(kept.error);
  assert.deepEqual(
    saved[0].attributes.map((v) => [String(v.attributeId), v.value]),
    [
      [IP_ATTR, "10.0.0.2"],
      [MAC_ATTR, "AA:BB:CC:DD:EE:FF"],
    ],
  );

  const cleared = await call(controller.update, {
    params: { id: String(pc._id) },
    body: { ...body, attributes: [{ attributeId: IP_ATTR, value: "" }] },
  });
  assert.ifError(cleared.error);
  assert.deepEqual(
    saved[1].attributes.map((v) => [String(v.attributeId), v.value]),
    [[MAC_ATTR, "AA:BB:CC:DD:EE:FF"]],
  );
});
