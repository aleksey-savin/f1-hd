// node --test services/inventory/deviceOps.test.js
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
const M1 = "bbbbbbbbbbbbbbbbbbbbbbb1";
const TYPE = "eeeeeeeeeeeeeeeeeeeeeee1";
const COMPANY = "111111111111111111111111";
const OTHER_COMPANY = "111111111111111111111112";
const LOCATION = "222222222222222222222222";
const USER = "333333333333333333333333";

// Сборочная часть (слоты и модели) — из deviceBuild; её у себя не проверяем
const build = require("@/controllers/inventory/deviceBuild");
stubModule("@/controllers/inventory/deviceBuild", {
  ...build,
  loadAssemblyType: async () => ({
    slots: [{ typeId: CPU, typeName: "Процессор", required: false, multiple: true }],
  }),
  resolveParts: async (parts) => ({ parts }),
});

const ClientDevice = require("@/models/inventory/clientDevice");
const Company = require("@/models/company");
const User = require("@/models/user");
const DeviceType = require("@/models/inventory/deviceType");
const Counter = require("@/models/inventory/counter");
const Location = require("@/models/inventory/location");
const DeviceConfiguration = require("@/models/inventory/deviceConfiguration");
const DeviceModel = require("@/models/inventory/deviceModel");
const {
  createDevice,
  checkNewDevice,
  createAgentDevice,
  checkAgentDevice,
  assignUser,
  checkAssignUser,
  attachComponent,
  checkAttachComponent,
  detachComponent,
  checkDetachComponent,
  moveDevice,
  checkMoveDevice,
  setDeviceStatus,
  checkSetDeviceStatus,
  patchDevice,
  checkPatchDevice,
} = require("./deviceOps");

const originals = {
  findOne: ClientDevice.findOne,
  findById: ClientDevice.findById,
  deleteMany: ClientDevice.deleteMany,
  deleteOne: ClientDevice.deleteOne,
  save: ClientDevice.prototype.save,
  company: Company.findById,
  user: User.findById,
  type: DeviceType.findById,
  seq: Counter.getNextSequence,
  find: ClientDevice.find,
  exists: ClientDevice.exists,
  location: Location.findById,
  config: DeviceConfiguration.findById,
};

let saved;
let deleted;
let seq;
let failOnSave;

test.beforeEach(() => {
  saved = [];
  deleted = { many: [], one: [] };
  seq = 0;
  failOnSave = null;
  ClientDevice.findOne = async () => null;
  ClientDevice.findById = async () => null;
  ClientDevice.deleteMany = async (filter) => {
    deleted.many.push(filter._id.$in.map(String));
  };
  ClientDevice.deleteOne = async (filter) => {
    deleted.one.push(String(filter._id));
  };
  ClientDevice.prototype.save = async function save() {
    if (failOnSave && failOnSave(this, saved.length)) {
      throw new Error("write failed");
    }
    saved.push(this);
    return this;
  };
  Company.findById = async (id) => (String(id) === COMPANY ? { _id: id } : null);
  User.findById = async () => ({ _id: USER, company: { _id: OTHER_COMPANY } });
  DeviceType.findById = (id) => {
    const doc = {
      _id: id,
      name: "ПК",
      inventoryPrefix: "PC",
      assembly: { enabled: true },
    };
    return Object.assign(Promise.resolve(doc), { select: async () => doc });
  };
  Counter.getNextSequence = async () => ++seq;
});

test.afterEach(() => {
  ClientDevice.findOne = originals.findOne;
  ClientDevice.findById = originals.findById;
  ClientDevice.deleteMany = originals.deleteMany;
  ClientDevice.deleteOne = originals.deleteOne;
  ClientDevice.prototype.save = originals.save;
  Company.findById = originals.company;
  User.findById = originals.user;
  DeviceType.findById = originals.type;
  Counter.getNextSequence = originals.seq;
  ClientDevice.find = originals.find;
  ClientDevice.exists = originals.exists;
  Location.findById = originals.location;
  DeviceConfiguration.findById = originals.config;
});

const body = (extra = {}) => ({
  companyId: COMPANY,
  locationId: LOCATION,
  deviceTypeId: TYPE,
  status: "readyForDeployment",
  ...extra,
});

test("занятый инвентарный номер: 409 с прежним текстом, записей нет", async () => {
  ClientDevice.findOne = async () => ({ _id: "x" });
  const res = await createDevice(body({ inventoryNumber: "INV-1" }), {
    userId: USER,
  });
  assert.deepEqual(res, {
    ok: false,
    status: 409,
    message: "Устройство с инвентарным номером INV-1 уже существует",
  });
  assert.equal(saved.length, 0);
});

test("пользователь другой компании: 400", async () => {
  const res = await checkNewDevice(body({ userId: USER }));
  assert.deepEqual(res, {
    ok: false,
    status: 400,
    message: "Assigned user must belong to the same company",
  });
});

test("checkNewDevice: план без записей", async () => {
  const res = await checkNewDevice(body());
  assert.equal(res.ok, true);
  assert.equal(String(res.plan.deviceTypeId), TYPE);
  assert.deepEqual(res.plan.parts, []);
  assert.equal(saved.length, 0);
});

test("своя сборка с деталями: ПК и детали, детали наследуют от ПК", async () => {
  const res = await createDevice(
    body({
      userId: undefined,
      parts: [{ typeId: CPU, deviceModelId: M1, serialNumber: "S1" }],
    }),
    { userId: USER },
  );
  assert.equal(res.ok, true);
  assert.equal(saved.length, 2);
  assert.equal(res.device.inventoryNumber, "PC-000001");
  assert.equal(res.parts.length, 1);
  const part = res.parts[0];
  assert.equal(String(part.parentDeviceId), String(res.device._id));
  assert.equal(String(part.companyId), COMPANY);
  assert.equal(String(part.locationId), LOCATION);
  assert.equal(part.status, "readyForDeployment");
  assert.equal(part.serialNumber, "S1");
  assert.equal(String(res.device.createdBy), USER);
});

test("сбой записи детали: ПК и созданные детали удаляются по _id", async () => {
  failOnSave = (_doc, already) => already === 2;
  const res = await createDevice(
    body({
      parts: [
        { typeId: CPU, deviceModelId: M1 },
        { typeId: CPU, deviceModelId: M1 },
      ],
      userId: undefined,
    }),
    { userId: USER },
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.equal(saved.length, 2);
  assert.deepEqual(deleted.many, [[String(saved[1]._id)]]);
  assert.deepEqual(deleted.one, [String(saved[0]._id)]);
});

test("E11000 при записи: 409 с названием поля", async () => {
  ClientDevice.prototype.save = async () => {
    const error = new Error("dup");
    error.code = 11000;
    error.keyPattern = { inventoryNumber: 1 };
    error.keyValue = { inventoryNumber: "INV-9" };
    throw error;
  };
  const res = await createDevice(body(), { userId: USER });
  assert.deepEqual(res, {
    ok: false,
    status: 409,
    message: "Устройство с таким инвентарным номером (INV-9) уже есть",
  });
});

// ─── Правки устройства: назначение, перенос, статус, сборка ───────────────

const HOST = "444444444444444444444441";
const C1 = "555555555555555555555551";
const C2 = "555555555555555555555552";
const C3 = "555555555555555555555553";
const C4 = "555555555555555555555554";
const LOC2 = "222222222222222222222223";

const doc = (extra) =>
  new ClientDevice({
    companyId: COMPANY,
    locationId: LOCATION,
    status: "deployed",
    userId: USER,
    deviceTypeId: TYPE,
    ...extra,
  });

// host + живые детали (C1, C2, C3); C4 удалена. Подмена find видит условие
// parentDeviceId/deletedAt так, как его пишет сервис.
const setupAssembly = () => {
  const host = doc({ _id: HOST });
  const parts = [C1, C2, C3].map((id) => doc({ _id: id, parentDeviceId: HOST }));
  const deletedPart = doc({
    _id: C4,
    parentDeviceId: HOST,
    deletedAt: new Date(),
  });
  const byId = new Map(
    [host, ...parts, deletedPart].map((d) => [String(d._id), d]),
  );
  ClientDevice.findById = async (id) => byId.get(String(id)) || null;
  ClientDevice.find = async (filter) => {
    assert.equal(String(filter.parentDeviceId), HOST);
    assert.equal(filter.deletedAt, null);
    return parts;
  };
  return { host, parts, deletedPart };
};

const savedIds = () => saved.map((d) => String(d._id));

test("moveDevice: чужое непубличное помещение: 400, записей нет", async () => {
  setupAssembly();
  Location.findById = async () => ({
    _id: LOC2,
    company: OTHER_COMPANY,
    isPublic: false,
  });
  const res = await moveDevice(HOST, LOC2, { actorId: USER });
  assert.deepEqual(res, {
    ok: false,
    status: 400,
    message:
      "Помещение другой компании: перенос возможен только в общее помещение",
  });
  assert.equal(saved.length, 0);
});

test("moveDevice: помещение не найдено: 400", async () => {
  setupAssembly();
  Location.findById = async () => null;
  const res = await moveDevice(HOST, LOC2, { actorId: USER });
  assert.deepEqual(res, {
    ok: false,
    status: 400,
    message: "Помещение не найдено",
  });
});

test("moveDevice: в общее помещение другой компании: ok, детали едут за хостом", async () => {
  setupAssembly();
  Location.findById = async () => ({
    _id: LOC2,
    company: OTHER_COMPANY,
    isPublic: true,
  });
  const res = await moveDevice(HOST, LOC2, { actorId: USER });
  assert.equal(res.ok, true);
  assert.equal(String(res.device.locationId), LOC2);
  assert.deepEqual(res.affected.map(String), [C1, C2, C3]);
});

test("moveDevice: каскад двигает живые детали, кроме исключённой и удалённой", async () => {
  const { parts } = setupAssembly();
  Location.findById = async () => ({ _id: LOC2, company: COMPANY });
  const res = await moveDevice(HOST, LOC2, {
    actorId: USER,
    exceptComponentIds: [C2],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.affected.map(String), [C1, C3]);
  assert.deepEqual(savedIds().sort(), [HOST, C1, C3].sort());
  assert.equal(String(parts[0].locationId), LOC2);
  assert.equal(String(parts[1].locationId), LOCATION);
  assert.equal(String(parts[0].updatedBy), USER);
});

test("moveDevice: withComponents false и снятие помещения (null)", async () => {
  setupAssembly();
  const res = await moveDevice(HOST, null, {
    actorId: USER,
    withComponents: false,
  });
  assert.equal(res.ok, true);
  assert.equal(res.device.locationId, undefined);
  assert.deepEqual(res.affected, []);
  assert.deepEqual(savedIds(), [HOST]);
});

test("checkMoveDevice: те же отказы и результат, но без записей", async () => {
  setupAssembly();
  Location.findById = async () => ({ _id: LOC2, company: COMPANY });
  const res = await checkMoveDevice(HOST, LOC2, { actorId: USER });
  assert.equal(res.ok, true);
  assert.deepEqual(res.affected.map((a) => String(a._id)), [C1, C2, C3]);
  assert.equal(saved.length, 0);
});

test("setDeviceStatus: inRepair снимает пользователя у хоста и деталей", async () => {
  const { host, parts } = setupAssembly();
  const res = await setDeviceStatus(HOST, "inRepair", { actorId: USER });
  assert.equal(res.ok, true);
  assert.equal(host.status, "inRepair");
  assert.equal(host.userId, undefined);
  assert.equal(parts[0].status, "inRepair");
  assert.equal(parts[0].userId, undefined);
  assert.equal(saved.length, 4);
});

test("setDeviceStatus: deployed оставляет пользователя; неизвестный статус: 400", async () => {
  const { host } = setupAssembly();
  const ok = await setDeviceStatus(HOST, "deployed", {
    actorId: USER,
    withComponents: false,
  });
  assert.equal(ok.ok, true);
  assert.equal(String(host.userId), USER);
  const bad = await checkSetDeviceStatus(HOST, "lost", { actorId: USER });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
});

test("patchDevice: companyId не в белом списке: 400", async () => {
  setupAssembly();
  const res = await patchDevice(HOST, { companyId: OTHER_COMPANY }, { actorId: USER });
  assert.deepEqual(res, {
    ok: false,
    status: 400,
    message: "Поле «companyId» нельзя менять через агента",
  });
  assert.equal(saved.length, 0);
});

test("patchDevice: меняет поля из белого списка и пишет updatedBy", async () => {
  const { host } = setupAssembly();
  const res = await patchDevice(
    HOST,
    { hostname: "pc-01", comment: "после ремонта", price: 1200 },
    { actorId: USER },
  );
  assert.equal(res.ok, true);
  assert.equal(host.hostname, "pc-01");
  assert.equal(host.price, 1200);
  assert.equal(String(host.updatedBy), USER);
  assert.deepEqual(res.affected.map(String), [HOST]);
});

test("patchDevice: занятые инвентарный номер и имя в сети: 409", async () => {
  setupAssembly();
  ClientDevice.findOne = async () => ({ _id: "x" });
  const inv = await checkPatchDevice(HOST, { inventoryNumber: "INV-7" }, { actorId: USER });
  assert.equal(inv.status, 409);
  const name = await checkPatchDevice(HOST, { hostname: "pc-01" }, { actorId: USER });
  assert.equal(name.status, 409);
  assert.match(name.message, /pc-01/);
});

test("patchDevice: конфигурация другой модели: 400", async () => {
  const { host } = setupAssembly();
  host.deviceModelId = M1;
  DeviceConfiguration.findById = async () => ({
    _id: C1,
    deviceModelId: "bbbbbbbbbbbbbbbbbbbbbbb2",
  });
  const res = await patchDevice(HOST, { configurationId: C1 }, { actorId: USER });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  DeviceConfiguration.findById = async () => ({ _id: C1, deviceModelId: M1 });
  const ok = await patchDevice(HOST, { configurationId: C1 }, { actorId: USER });
  assert.equal(ok.ok, true);
});

test("assignUser без каскада (путь контроллера) не трогает детали", async () => {
  const { host } = setupAssembly();
  host.status = "readyForDeployment";
  host.userId = undefined;
  User.findById = async () => ({ _id: USER, company: { _id: COMPANY } });
  const res = await assignUser(HOST, USER, { actorId: USER });
  assert.equal(res.ok, true);
  assert.equal(host.status, "deployed");
  assert.deepEqual(res.affected, []);
  assert.deepEqual(savedIds(), [HOST]);
});

test("assignUser с каскадом: пользователь и статус уходят в живые детали", async () => {
  const { parts } = setupAssembly();
  User.findById = async () => ({ _id: USER, company: { _id: COMPANY } });
  const res = await assignUser(HOST, USER, {
    actorId: USER,
    withComponents: true,
    exceptComponentIds: [C3],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.affected.map(String), [C1, C2]);
  assert.equal(String(parts[0].userId), USER);
  assert.equal(parts[2].updatedBy, undefined); // исключённая не тронута
});

test("assignUser: пользователь другой компании: 400; снятие: deployed -> readyForDeployment", async () => {
  const { host } = setupAssembly();
  const bad = await checkAssignUser(HOST, USER, { actorId: USER });
  assert.deepEqual(bad, {
    ok: false,
    status: 400,
    message: "Assigned user must belong to the same company",
  });
  const res = await assignUser(HOST, null, { actorId: USER });
  assert.equal(res.ok, true);
  assert.equal(host.userId, undefined);
  assert.equal(host.status, "readyForDeployment");
});

test("assignUser: нет устройства: 404", async () => {
  ClientDevice.findById = async () => null;
  const res = await checkAssignUser(HOST, null, { actorId: USER });
  assert.deepEqual(res, {
    ok: false,
    status: 404,
    message: `Device with id ${HOST} not found`,
  });
});

test("detachComponent: снимает связь, пользователя и ставит readyForDeployment", async () => {
  const { parts } = setupAssembly();
  const bad = await checkDetachComponent("444444444444444444444449", C1, { actorId: USER });
  assert.equal(bad.status, 400);
  const res = await detachComponent(HOST, C1, { actorId: USER });
  assert.equal(res.ok, true);
  assert.equal(parts[0].parentDeviceId, undefined);
  assert.equal(parts[0].userId, undefined);
  assert.equal(parts[0].status, "readyForDeployment");
  assert.deepEqual(res.affected.map(String), [C1]);
});

test("attachComponent: следует за хостом; сборку и чужую сборку не берёт", async () => {
  const host = doc({ _id: HOST });
  const free = doc({
    _id: C1,
    status: "readyForDeployment",
    userId: undefined,
    companyId: OTHER_COMPANY,
  });
  ClientDevice.findById = async (id) =>
    ({ [HOST]: host, [C1]: free })[String(id)] || null;
  ClientDevice.exists = async () => null;
  DeviceType.findById = (id) => {
    const doc2 = { _id: id, isComponent: true, attachableToTypeIds: [] };
    return Object.assign(Promise.resolve(doc2), { select: async () => doc2 });
  };
  const res = await attachComponent(HOST, C1, { actorId: USER });
  assert.equal(res.ok, true);
  assert.equal(String(free.parentDeviceId), HOST);
  assert.equal(String(free.companyId), COMPANY);
  assert.equal(free.status, "deployed");
  assert.equal(String(free.userId), USER);

  ClientDevice.exists = async () => ({ _id: "x" });
  const asm = await checkAttachComponent(HOST, C1, { actorId: USER });
  assert.equal(asm.status, 409);
  const self = await checkAttachComponent(HOST, HOST, { actorId: USER });
  assert.deepEqual(self, {
    ok: false,
    status: 400,
    message: "Нельзя прикрепить устройство к самому себе",
  });
});

test("attachComponent: тип не комплектующее: 400", async () => {
  const host = doc({ _id: HOST });
  const free = doc({ _id: C1 });
  ClientDevice.findById = async (id) =>
    ({ [HOST]: host, [C1]: free })[String(id)] || null;
  ClientDevice.exists = async () => null;
  DeviceType.findById = (id) => {
    const doc2 = { _id: id };
    return Object.assign(Promise.resolve(doc2), { select: async () => doc2 });
  };
  const res = await checkAttachComponent(HOST, C1, { actorId: USER });
  assert.deepEqual(res, {
    ok: false,
    status: 400,
    message: "Этот тип устройства нельзя прикреплять как комплектующее",
  });
});

// ─── Раунд правок ревью ───────────────────────────────────────────────────

test("снятие пользователя с каскадом: деталь в ремонте остаётся inRepair", async () => {
  const { parts } = setupAssembly();
  parts[1].status = "inRepair";
  parts[1].userId = undefined;
  const res = await assignUser(HOST, null, {
    actorId: USER,
    withComponents: true,
  });
  assert.equal(res.ok, true);
  assert.equal(parts[0].status, "readyForDeployment");
  assert.equal(parts[1].status, "inRepair");
  assert.equal(parts[0].userId, undefined);
});

test("check: значения, которые save отвергнет, дают 400, а не 500", async () => {
  setupAssembly();
  for (const patch of [{ purchasedAt: true }, { serialNumber: { a: 1 } }]) {
    const res = await checkPatchDevice(HOST, patch, { actorId: USER });
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.match(res.message, /^Неверное значение поля «(purchasedAt|serialNumber)»$/);
  }
  // сама валидация Mongoose: кривой id пользователя -> CastError -> 400
  User.findById = async () => ({ _id: USER, company: { _id: COMPANY } });
  const bad = await checkAssignUser(HOST, "zzz", { actorId: USER });
  assert.deepEqual(bad, {
    ok: false,
    status: 400,
    message: "Неверное значение поля «userId»",
  });
  // настоящий save валидирует сам — подменённый ведём через validate
  ClientDevice.prototype.save = function save() {
    return this.validate();
  };
  const real = await assignUser(HOST, "zzz", { actorId: USER });
  assert.equal(real.status, 400);
  assert.equal(real.message, "Неверное значение поля «userId»");
});

test("check-близнецы каскада отдают снимок { _id, updatedAt }", async () => {
  const { parts } = setupAssembly();
  parts[0].updatedAt = new Date("2026-01-01");
  Location.findById = async () => ({ _id: LOC2, company: COMPANY });
  const res = await checkMoveDevice(HOST, LOC2, { actorId: USER });
  assert.deepEqual(res.affected[0], {
    _id: parts[0]._id,
    updatedAt: parts[0].updatedAt,
  });
  const real = await moveDevice(HOST, LOC2, { actorId: USER });
  assert.deepEqual(real.affected.map(String), [C1, C2, C3]);
});

test("componentIds: каскад ровно по списку; открепившаяся деталь: 409 с названием", async () => {
  const { parts } = setupAssembly();
  Location.findById = async () => ({ _id: LOC2, company: COMPANY });
  const res = await moveDevice(HOST, LOC2, {
    actorId: USER,
    componentIds: [C3],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.affected.map(String), [C3]);
  assert.equal(String(parts[2].locationId), LOC2);
  assert.equal(String(parts[0].locationId), LOCATION);

  saved.length = 0;
  const gone = doc({
    _id: C4,
    inventoryNumber: "RAM-000007",
  });
  const base = ClientDevice.findById;
  ClientDevice.findById = async (id) =>
    String(id) === C4 ? gone : base(id);
  const stale = await checkSetDeviceStatus(HOST, "inRepair", {
    actorId: USER,
    componentIds: [C1, C4],
  });
  assert.deepEqual(stale, {
    ok: false,
    status: 409,
    message: "Деталь «RAM-000007» уже не в составе устройства",
  });
  assert.equal(saved.length, 0);
});

test("attach: имя в сети детали занято в компании хоста: 409 до записи", async () => {
  const host = doc({ _id: HOST });
  const free = doc({ _id: C1, hostname: "pc-9", companyId: OTHER_COMPANY });
  ClientDevice.findById = async (id) =>
    ({ [HOST]: host, [C1]: free })[String(id)] || null;
  ClientDevice.exists = async () => null;
  ClientDevice.findOne = async (filter) =>
    filter.hostname === "pc-9" ? { _id: "x" } : null;
  DeviceType.findById = (id) => {
    const d = { _id: id, isComponent: true, attachableToTypeIds: [] };
    return Object.assign(Promise.resolve(d), { select: async () => d });
  };
  const res = await checkAttachComponent(HOST, C1, { actorId: USER });
  assert.equal(res.status, 409);
  assert.match(res.message, /pc-9/);
});

// ─── Путь агента: поля формы и правила установки детали ───────────────────

// Тип по id: COMPONENT_TYPE — комплектующее, ограниченное хостами типа TYPE
const COMPONENT_TYPE = "eeeeeeeeeeeeeeeeeeeeeee2";
const stubTypes = (extra = {}) => {
  DeviceType.findById = (id) => {
    const d =
      String(id) === COMPONENT_TYPE
        ? { _id: id, name: "ОЗУ", isComponent: true, attachableToTypeIds: [TYPE], ...extra }
        : { _id: id, name: "ПК", inventoryPrefix: "PC", assembly: { enabled: true } };
    return Object.assign(Promise.resolve(d), { select: async () => d });
  };
};

test("агент: поля как у формы — кривой IP и длинный серийник: 400 с именем поля, записей нет", async () => {
  const ip = await createAgentDevice(body({ ipAddress: "999.1.1.1" }), { userId: USER });
  assert.deepEqual(ip, { ok: false, status: 400, message: "Поле «ipAddress»: некорректный IP-адрес" });
  const serial = await checkAgentDevice(body({ serialNumber: "S".repeat(101) }));
  assert.deepEqual(serial, {
    ok: false,
    status: 400,
    message: "Поле «serialNumber»: серийный номер должен содержать от 1 до 100 символов",
  });
  assert.equal(saved.length, 0);
  // портал этих проверок здесь не делает (их делает маршрут)
  assert.equal((await checkNewDevice(body({ ipAddress: "999.1.1.1" }))).ok, true);
});

test("агент: правка — те же цепочки, только по переданным полям", async () => {
  setupAssembly();
  const ip = await checkPatchDevice(HOST, { ipAddress: "10.0.0.300" }, { actorId: USER });
  assert.deepEqual(ip, { ok: false, status: 400, message: "Поле «ipAddress»: некорректный IP-адрес" });
  const serial = await patchDevice(HOST, { serialNumber: "x".repeat(101) }, { actorId: USER });
  assert.equal(serial.status, 400);
  assert.match(serial.message, /^Поле «serialNumber»: /);
  assert.equal(saved.length, 0);
  // companyId/deviceModelId не переданы — их «обязательные» цепочки не мешают
  const ok = await checkPatchDevice(HOST, { ipAddress: "10.0.0.30" }, { actorId: USER });
  assert.equal(ok.ok, true);
});

test("агент: деталь в хост — правила прикрепления и статус хоста", async () => {
  const host = doc({ _id: HOST, status: "inRepair", userId: undefined });
  ClientDevice.findById = async (id) => (String(id) === HOST ? host : null);
  User.findById = async () => ({ _id: USER, company: { _id: COMPANY } });
  Location.findById = async () => ({ _id: LOCATION, company: COMPANY });
  stubTypes();
  // статус не указан — берётся у хоста молча
  const part = body({ parentDeviceId: HOST, deviceTypeId: COMPONENT_TYPE, status: undefined });
  const res = await createAgentDevice(part, { userId: USER });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.device.status, "inRepair");
  assert.equal(String(res.device.parentDeviceId), HOST);
  // автор — и в updatedBy
  assert.equal(String(res.device.createdBy), USER);
  assert.equal(String(res.device.updatedBy), USER);

  // тип не комплектующее
  stubTypes({ isComponent: false });
  const notPart = await checkAgentDevice(part);
  assert.deepEqual(notPart, {
    ok: false,
    status: 400,
    message: "Этот тип устройства нельзя прикреплять как комплектующее",
  });
  // тип ограничен другими хостами
  stubTypes({ attachableToTypeIds: ["eeeeeeeeeeeeeeeeeeeeeee9"] });
  const wrongHost = await checkAgentDevice(part);
  assert.equal(wrongHost.message, "Этот компонент несовместим с типом хоста");
  // хост сам деталь — один уровень
  stubTypes();
  host.parentDeviceId = C1;
  const nested = await checkAgentDevice(part);
  assert.equal(nested.status, 400);
  assert.match(nested.message, /^Устройство-хост само входит в сборку/);
});

test("агент: деталь берёт у хоста компанию, помещение, пользователя и статус; другое — отказ с полем", async () => {
  const host = doc({ _id: HOST, status: "inRepair", userId: USER, locationId: LOC2 });
  ClientDevice.findById = async (id) => (String(id) === HOST ? host : null);
  User.findById = async () => ({ _id: USER, company: { _id: COMPANY } });
  // помещение детали не проверяется отдельно: оно хостовое
  Location.findById = async () => {
    throw new Error("помещение детали не проверяется");
  };
  stubTypes();
  const part = (extra = {}) => ({ parentDeviceId: HOST, deviceTypeId: COMPONENT_TYPE, ...extra });

  // ничего не указано — всё от хоста, компания тоже не нужна
  const inherited = await createAgentDevice(part(), { userId: USER });
  assert.equal(inherited.ok, true, inherited.message);
  assert.equal(String(inherited.device.companyId), COMPANY);
  assert.equal(String(inherited.device.locationId), LOC2);
  assert.equal(String(inherited.device.userId), USER);
  assert.equal(inherited.device.status, "inRepair");

  // указано то же, что у хоста, — можно
  const same = await checkAgentDevice(
    part({ companyId: COMPANY, locationId: LOC2, userId: USER, status: "inRepair" }),
  );
  assert.equal(same.ok, true, same.message);

  // указано другое — отказ, поле названо
  const refusals = [
    [{ companyId: OTHER_COMPANY }, "Деталь получает компанию хоста — не указывайте другую"],
    [{ locationId: LOCATION }, "Деталь получает помещение хоста — не указывайте другое"],
    [{ userId: "333333333333333333333334" }, "Деталь получает пользователя хоста — не указывайте другого"],
    [{ status: "deployed" }, "Деталь получает статус хоста — не указывайте другой"],
  ];
  for (const [extra, message] of refusals) {
    assert.deepEqual(await checkAgentDevice(part(extra)), { ok: false, status: 400, message });
  }
  // у хоста нет пользователя — указанный пользователь тоже «другой»
  host.userId = undefined;
  assert.equal(
    (await checkAgentDevice(part({ userId: USER }))).message,
    "Деталь получает пользователя хоста — не указывайте другого",
  );
  assert.equal(saved.length, 1);
  // портал — как раньше: указанный статус детали остаётся
  const portal = await checkNewDevice(part({ status: "deployed" }));
  assert.equal(portal.ok, true, portal.message);
  assert.equal(portal.plan.payload.status, "deployed");
});

test("агент: помещение — своей компании или общее; конфигурация — этой модели", async () => {
  Location.findById = async () => ({ _id: LOCATION, company: OTHER_COMPANY, isPublic: false });
  const foreign = await checkAgentDevice(body());
  assert.deepEqual(foreign, {
    ok: false,
    status: 400,
    message: "Помещение другой компании: перенос возможен только в общее помещение",
  });
  Location.findById = async () => ({ _id: LOCATION, company: OTHER_COMPANY, isPublic: true });
  assert.equal((await checkAgentDevice(body())).ok, true);

  Location.findById = async () => ({ _id: LOCATION, company: COMPANY });
  const originalModel = DeviceModel.findById;
  DeviceModel.findById = async () => ({ _id: M1, deviceTypeId: TYPE });
  try {
    DeviceConfiguration.findById = async () => ({ _id: C1, deviceModelId: "bbbbbbbbbbbbbbbbbbbbbbb2" });
    const withModel = body({ deviceTypeId: undefined, deviceModelId: M1, configurationId: C1 });
    const wrong = await checkAgentDevice(withModel);
    assert.deepEqual(wrong, { ok: false, status: 400, message: "Конфигурация не относится к модели устройства" });
    DeviceConfiguration.findById = async () => ({ _id: C1, deviceModelId: M1 });
    assert.equal((await checkAgentDevice(withModel)).ok, true);
  } finally {
    DeviceModel.findById = originalModel;
  }
});

test("агент: ПК своей сборки — updatedBy и у деталей", async () => {
  Location.findById = async () => ({ _id: LOCATION, company: COMPANY });
  const res = await createAgentDevice(
    body({ parts: [{ typeId: CPU, deviceModelId: M1 }] }),
    { userId: USER },
  );
  assert.equal(res.ok, true);
  assert.equal(String(res.parts[0].updatedBy), USER);
  assert.equal(String(res.parts[0].createdBy), USER);
  // портал updatedBy при создании не ставит — как раньше
  const portal = await createDevice(body(), { userId: USER });
  assert.equal(portal.device.updatedBy, undefined);
});

test("check-близнецы правки и статуса отдают прежние значения изменённых полей", async () => {
  const { host } = setupAssembly();
  host.serialNumber = "SN-1";
  host.purchasedAt = new Date("2025-03-04T00:00:00Z");
  const patched = await checkPatchDevice(HOST, { serialNumber: "SN-9", purchasedAt: "2026-01-02", comment: null }, { actorId: USER });
  assert.equal(patched.ok, true);
  assert.deepEqual(Object.keys(patched.before).sort(), ["comment", "purchasedAt", "serialNumber"]);
  assert.equal(patched.before.serialNumber, "SN-1");
  assert.equal(patched.before.purchasedAt.toISOString(), "2025-03-04T00:00:00.000Z");
  assert.equal(patched.before.comment, undefined);
  // проверка документ меняет в памяти, прежнее — снято до этого
  assert.equal(host.serialNumber, "SN-9");

  setupAssembly();
  const status = await checkSetDeviceStatus(HOST, "inRepair", { actorId: USER, withComponents: false });
  assert.equal(status.ok, true);
  assert.deepEqual(status.before, { status: "deployed" });
  // запись прежнего не отдаёт: оно нужно только предложению
  const real = await setDeviceStatus(HOST, "inRepair", { actorId: USER, withComponents: false });
  assert.equal(real.before, undefined);
});
