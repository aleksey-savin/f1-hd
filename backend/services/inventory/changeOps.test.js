// node --test services/inventory/changeOps.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
// Базы нет: забытая подмена падает сразу, а не висит в буфере
mongoose.set("bufferCommands", false);

const { createChangeOps, uniqueStatements, KINDS: DEFAULT_KINDS } = require("./changeOps");

const TYPE = "eeeeeeeeeeeeeeeeeeeeeee1";
const VENDOR = "fffffffffffffffffffffff1";
const MODEL = "bbbbbbbbbbbbbbbbbbbbbbb1";
const CONF = "ccccccccccccccccccccccc1";
const BUILD = "ddddddddddddddddddddddd1";
const HOST = "aaaaaaaaaaaaaaaaaaaaaaa1";
const PART1 = "aaaaaaaaaaaaaaaaaaaaaaa2";
const PART2 = "aaaaaaaaaaaaaaaaaaaaaaa3";
const LOC = "999999999999999999999991";
const USER = "333333333333333333333331";
const COMPANY = "444444444444444444444441";
const SUPPLIER = "555555555555555555555551";
const ACTOR = "777777777777777777777771";
const MISSING = "000000000000000000000000";
const GROUP = "dddddddddddddddddddddd01";
const SUPPLIER_HIDDEN = "555555555555555555555553";

const NEW_MODEL = "6666666666666666666666a1";
const NEW_DEVICE = "6666666666666666666666a2";
const NEW_TYPE = "6666666666666666666666a3";
const NEW_VENDOR = "6666666666666666666666a4";
const HIDDEN_VENDOR = "6666666666666666666666b1";
const HIDDEN_MODEL = "6666666666666666666666b2";
const HIDDEN_TYPE = "6666666666666666666666b4";
const DELETED_MODEL = "6666666666666666666666b5";
const DELETED_DEVICE = "6666666666666666666666b3";

// Для полей страницы: длинные имена и прежний поставщик
const SYS_TYPE = "eeeeeeeeeeeeeeeeeeeeeee2";
const COMPANY2 = "444444444444444444444442";
const OLD_SUPPLIER = "555555555555555555555552";

const T1 = new Date("2026-10-01T10:00:00Z");
const T2 = new Date("2026-10-02T10:00:00Z");
const T3 = new Date("2026-10-03T10:00:00Z");

// Справочник «базы»: модель → id → { name, updatedAt }
const DB = {
  // созданное пакетом при применении тоже находится
  DeviceType: {
    [TYPE]: { name: "Ноутбук", updatedAt: T1 },
    [NEW_TYPE]: { name: "Моноблок", updatedAt: T3 },
    [SYS_TYPE]: { name: "Системный блок", updatedAt: T1 },
  },
  Vendor: {
    [VENDOR]: { name: "Lenovo", updatedAt: T1 },
    [HIDDEN_VENDOR]: { name: "Старый вендор", updatedAt: T1, hidden: true },
  },
  DeviceModel: {
    [MODEL]: { name: "Lenovo ThinkPad X1", updatedAt: T2 },
    [NEW_MODEL]: { name: "Lenovo T14", updatedAt: T3 },
    [HIDDEN_MODEL]: { name: "Lenovo Old", updatedAt: T1, hidden: true, deleted: true },
  },
  DeviceConfiguration: { [CONF]: { name: "16/512", updatedAt: T1 } },
  DeviceBuild: { [BUILD]: { name: "Офисный", updatedAt: T1 } },
  ClientDevice: {
    [HOST]: { name: "ПК PC-000123", updatedAt: T1 },
    [DELETED_DEVICE]: { name: "ПК PC-000999", updatedAt: T1, hidden: true, deleted: true },
    [PART1]: { name: "ОЗУ RAM-000045", updatedAt: T2 },
    [PART2]: { name: "SSD SSD-000012", updatedAt: T3 },
  },
  Location: { [LOC]: { name: "Кабинет 214", updatedAt: T1 } },
  User: { [USER]: { name: "Иванова Анна", updatedAt: T1 } },
  Company: { [COMPANY]: { name: "Ромашка", updatedAt: T1 }, [COMPANY2]: { name: "ООО Ромашка и партнёры", updatedAt: T1 } },
  Supplier: { [SUPPLIER]: { name: "Ситилинк", updatedAt: T1 }, [OLD_SUPPLIER]: { name: "Регард", updatedAt: T1 } },
  AttributeGroup: { [GROUP]: { name: "Процессор", updatedAt: T1 } },
};
DB.Supplier[SUPPLIER_HIDDEN] = { name: "Старый поставщик", updatedAt: T1, hidden: true };
DB.DeviceType[HIDDEN_TYPE] = { name: "Старый тип", updatedAt: T1, hidden: true };
DB.DeviceModel[DELETED_MODEL] = { name: "Lenovo Deleted", updatedAt: T1, hidden: true, deleted: true };
const ATTR = "a0000000000000000000a001";
const HIDDEN_ATTR = "a0000000000000000000a004";
const DELETED_BUILD = "ddddddddddddddddddddddd9";
DB.DeviceAttribute = {
  [ATTR]: { name: "Тип памяти", updatedAt: T1 },
  [HIDDEN_ATTR]: { name: "Старый атрибут", updatedAt: T1, hidden: true },
};
DB.DeviceBuild[DELETED_BUILD] = { name: "Удалённый", updatedAt: T1, hidden: true, deleted: true };
const ATTR2 = "a0000000000000000000a002";
DB.DeviceAttribute[ATTR2] = { name: "Тип ОЗУ", updatedAt: T2 };

// Ещё вендоры и группа для слияний
const VENDOR2 = "fffffffffffffffffffffff2";
const VENDOR3 = "fffffffffffffffffffffff3";
const GROUP2 = "dddddddddddddddddddddd02";
DB.Vendor[VENDOR2] = { name: "Lenovo Inc", updatedAt: T1 };
DB.Vendor[VENDOR3] = { name: "Lenovo Group", updatedAt: T1 };
DB.AttributeGroup[GROUP2] = { name: "ЦП", updatedAt: T1 };
// id ссылок в снимке слияния (по умолчанию — конфигурация CONF и устройство HOST)
const MERGE_IDS = { ClientDevice: [HOST], DeviceConfiguration: [CONF] };
const mergeSnap = (entity, source, target, ids = MERGE_IDS) => ({
  entity,
  source,
  target,
  refs: Object.entries(ids).map(([model, list]) => ({
    model,
    path: "deviceModelId",
    ids: list,
    live: list.length,
    deleted: 0,
    deletedIds: [],
  })),
});
const mergePlan = (entity, source, target, extra = {}) => ({
  ok: true,
  refs: mergeSnap(entity, source, target),
  conflicts: [],
  targets: [],
  lines: ["устройств: 1", "конфигураций: 1"],
  deviceLabels: ["ПК PC-000123"],
  devices: [{ id: HOST, label: "ПК PC-000123" }],
  moreDevices: 0,
  multiOn: false,
  newName: "Старое (слито в «Новое»)",
  ...extra,
});

const CASCADE = [
  { _id: PART1, updatedAt: T2 },
  { _id: PART2, updatedAt: T3 },
];

// Подделки Task 1–3: каждая пишет вызов в журнал и отдаёт заданный ответ.
const fakeDeps = (overrides = {}) => {
  const calls = [];
  const fn =
    (name, result) =>
    async (...args) => {
      calls.push({ name, args });
      return typeof result === "function" ? result(...args) : result;
    };
  const deviceOps = {
    checkAgentDevice: fn("checkAgentDevice", { ok: true, plan: {} }),
    createAgentDevice: fn("createAgentDevice", { ok: true, device: { _id: NEW_DEVICE }, parts: [] }),
    checkAssignUser: fn("checkAssignUser", { ok: true, device: {}, affected: CASCADE }),
    assignUser: fn("assignUser", { ok: true, device: {}, affected: [PART1, PART2] }),
    checkMoveDevice: fn("checkMoveDevice", { ok: true, device: {}, affected: CASCADE }),
    moveDevice: fn("moveDevice", { ok: true, device: {}, affected: [PART1, PART2] }),
    checkSetDeviceStatus: fn("checkSetDeviceStatus", { ok: true, device: {}, affected: [] }),
    setDeviceStatus: fn("setDeviceStatus", { ok: true, device: {}, affected: [] }),
    checkPatchDevice: fn("checkPatchDevice", { ok: true, device: {}, affected: [HOST] }),
    patchDevice: fn("patchDevice", { ok: true, device: {}, affected: [HOST] }),
    checkAttachComponent: fn("checkAttachComponent", { ok: true, device: {}, affected: [PART1] }),
    attachComponent: fn("attachComponent", { ok: true, device: {}, affected: [PART1] }),
    checkDetachComponent: fn("checkDetachComponent", { ok: true, device: {}, affected: [PART1] }),
    detachComponent: fn("detachComponent", { ok: true, device: {}, affected: [PART1] }),
    ...overrides.deviceOps,
  };
  const catalogOps = {
    checkCatalogPatch: fn("checkCatalogPatch", { ok: true, text: "Новый тип «Моноблок» (комплектующая: нет)" }),
    applyCatalogPatch: fn("applyCatalogPatch", {
      ok: true,
      ids: { groups: {}, types: { mono: NEW_TYPE }, attributes: {} },
    }),
    checkVendor: fn("checkVendor", (p) => ({ ok: true, text: `Новый вендор «${p.name}»` })),
    createVendor: fn("createVendor", { ok: true, id: NEW_VENDOR }),
    checkSupplier: fn("checkSupplier", (p) => ({ ok: true, text: `Новый поставщик «${p.name}»` })),
    createSupplier: fn("createSupplier", { ok: true, id: SUPPLIER }),
    checkModel: fn("checkModel", { ok: true, text: "Новая модель Lenovo T14 (Ноутбук)" }),
    createModel: fn("createModel", { ok: true, id: NEW_MODEL }),
    checkConfiguration: fn("checkConfiguration", { ok: true, text: "Новая конфигурация «8/256» для Lenovo ThinkPad X1" }),
    createConfiguration: fn("createConfiguration", { ok: true, id: CONF }),
    checkBuild: fn("checkBuild", { ok: true, text: "Новая сборка «Офисный» (Ноутбук)" }),
    createBuild: fn("createBuild", { ok: true, id: BUILD }),
    ...overrides.catalogOps,
  };
  const edit = (name, before = {}) => [
    [`checkUpdate${name}`, fn(`checkUpdate${name}`, { ok: true, before })],
    [`applyUpdate${name}`, fn(`applyUpdate${name}`, { ok: true, id: "x" })],
  ];
  const catalogEditOps = {
    ...Object.fromEntries(
      ["Vendor", "Supplier", "Model", "DeviceType", "Group", "Attribute", "TypeAttribute", "Configuration", "Build"].flatMap((name) =>
        edit(name),
      ),
    ),
    checkUnlinkAttribute: fn("checkUnlinkAttribute", { ok: true, before: {} }),
    applyUnlinkAttribute: fn("applyUnlinkAttribute", { ok: true, id: "x" }),
    ...overrides.catalogEditOps,
  };
  // Слияния: план отдаёт снимок с заданными id ссылок (MERGE_IDS), применение — числа
  const catalogMerge = {
    plan: fn("planMerge", (entity, source, target) => mergePlan(entity, source, target)),
    apply: fn("applyMerge", { ok: true, moved: { устройств: 2 } }),
    drift: fn("mergeDrift", null),
    ...overrides.catalogMerge,
  };
  const describe = async (model, id) => {
    calls.push({ name: "describe", args: [model, id] });
    return DB[model]?.[id] ?? null;
  };
  const attributeNames = async (codes) =>
    Object.fromEntries(codes.filter((c) => c === "ram_gb").map((c) => [c, "Объём ОЗУ"]));
  const log = (level, message, meta) => calls.push({ name: "log", args: [level, message, meta] });
  // Живые детали в «базе»: у HOST — PART1 и PART2
  const liveParts = async (hostId) => {
    calls.push({ name: "liveParts", args: [hostId] });
    return hostId === HOST ? [PART1, PART2] : [];
  };
  return {
    deps: { deviceOps, catalogOps, catalogEditOps, catalogMerge, describe, attributeNames, liveParts, log, ...overrides.extra },
    calls,
  };
};

const ctx = { userId: ACTOR, now: new Date("2026-10-20T10:00:00Z") };
const called = (calls, name) => calls.filter((c) => c.name === name);

// ─── Реестр ─────────────────────────────────────────────────────────────────

test("KINDS: замороженный реестр, права и refKinds по таблице", () => {
  const { KINDS } = createChangeOps(fakeDeps().deps);
  assert.ok(Object.isFrozen(KINDS));
  assert.ok(Object.isFrozen(DEFAULT_KINDS));
  assert.deepEqual(Object.keys(KINDS).sort(), [
    "assignDevice",
    "attachComponent",
    "catalog",
    "createBuild",
    "createConfiguration",
    "createDevice",
    "createModel",
    "createSupplier",
    "createVendor",
    "deleteGroup",
    "detachComponent",
    "mergeAttributes",
    "mergeConfigurations",
    "mergeDeviceTypes",
    "mergeGroups",
    "mergeModels",
    "mergeSuppliers",
    "mergeVendors",
    "moveDevice",
    "retireAttribute",
    "retireDeviceType",
    "retireModel",
    "retireSupplier",
    "retireVendor",
    "setDeviceStatus",
    "unlinkAttribute",
    "updateAttribute",
    "updateBuild",
    "updateConfiguration",
    "updateDevice",
    "updateDeviceType",
    "updateGroup",
    "updateModel",
    "updateSupplier",
    "updateTypeAttribute",
    "updateVendor",
  ]);
  const catalogRight = { inventoryCatalog: ["manage"] };
  const deviceRight = { device: ["manage"] };
  for (const kind of ["catalog", "createVendor", "createModel", "createConfiguration", "createBuild"]) {
    assert.deepEqual(KINDS[kind].right, catalogRight, kind);
  }
  assert.deepEqual(KINDS.createSupplier.right, { supplier: ["manage"] });
  for (const kind of [
    "updateVendor",
    "updateModel",
    "updateDeviceType",
    "updateGroup",
    "updateAttribute",
    "updateTypeAttribute",
    "unlinkAttribute",
    "updateConfiguration",
    "updateBuild",
  ]) {
    assert.deepEqual(KINDS[kind].right, catalogRight, kind);
  }
  assert.deepEqual(KINDS.updateSupplier.right, { supplier: ["manage"] });
  for (const kind of [
    "createDevice",
    "updateDevice",
    "assignDevice",
    "moveDevice",
    "setDeviceStatus",
    "attachComponent",
    "detachComponent",
  ]) {
    assert.deepEqual(KINDS[kind].right, deviceRight, kind);
  }
  assert.deepEqual(KINDS.catalog.refKinds, ["type", "attribute"]);
  assert.deepEqual(KINDS.createModel.refKinds, ["model"]);
  assert.deepEqual(KINDS.createDevice.refKinds, ["device"]);
  assert.deepEqual(KINDS.moveDevice.refKinds, []);
  for (const def of Object.values(KINDS)) {
    assert.equal(typeof def.check, "function");
    assert.equal(typeof def.apply, "function");
  }
});

test("requiredRights: уникальные утверждения в порядке появления", () => {
  const { requiredRights } = createChangeOps(fakeDeps().deps);
  const rights = requiredRights([
    { kind: "moveDevice", params: {} },
    { kind: "createVendor", params: {} },
    { kind: "setDeviceStatus", params: {} },
    { kind: "createSupplier", params: {} },
    { kind: "catalog", params: {} },
    { kind: "nope", params: {} },
  ]);
  assert.deepEqual(rights, [
    { device: ["manage"] },
    { inventoryCatalog: ["manage"] },
    { supplier: ["manage"] },
  ]);
});

// ─── Скрытые записи ─────────────────────────────────────────────────────────

test("createModel: скрытый вендор — отказ", async () => {
  const { deps } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [{ kind: "createModel", params: { type: TYPE, vendor: HIDDEN_VENDOR, name: "T14" } }],
    ctx,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ["Операция 1: вендор «Старый вендор» скрыт"]);
});

test("createDevice: скрытая модель — отказ (и при применении)", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [{ kind: "createDevice", params: { deviceModelId: HIDDEN_MODEL, companyId: COMPANY } }],
    ctx,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ["Операция 1: модель Lenovo Old скрыта"]);
  assert.equal(called(calls, "checkAgentDevice").length, 0);
});

test("удалённое устройство — «удалено», не «скрыто»", async () => {
  const { deps } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage([{ kind: "moveDevice", params: { device: DELETED_DEVICE, location: LOC } }], ctx);
  assert.deepEqual(result.reasons, ["Операция 1: устройство ПК PC-000999 удалено"]);
});

// ─── Пакет: ссылки (Review Focus 5) ─────────────────────────────────────────

test("checkPackage: ссылка на позднюю, на отсутствующую и на несовместимую операцию — все причины сразу", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [
      { kind: "createVendor", ref: "v1", params: { name: "Lenovo" } },
      { kind: "createDevice", params: { deviceModelId: { ref: "m1" }, companyId: COMPANY } },
      { kind: "createModel", ref: "m1", params: { type: TYPE, vendor: { ref: "v1" }, name: "T14" } },
      { kind: "createDevice", params: { deviceModelId: { ref: "zz" }, companyId: COMPANY } },
      { kind: "createDevice", params: { deviceModelId: { ref: "v1" }, companyId: COMPANY } },
    ],
    ctx,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, [
    "Операция 2: ссылка m1 ещё не определена",
    "Операция 4: ссылка zz не найдена",
    "Операция 5: ссылка v1 в «deviceModelId» — вендор, а нужна модель",
  ]);
  // Операции со сломанными ссылками до проверки сервисом не доходят
  assert.equal(called(calls, "checkAgentDevice").length, 0);
});

test("checkPackage: неизвестный вид, плохой и повторный ref, неизвестный параметр, плохая сущность", async () => {
  const { checkPackage } = createChangeOps(fakeDeps().deps);
  const result = await checkPackage(
    [
      { kind: "deleteDevice", params: {} },
      { kind: "createVendor", ref: "V-1", params: { name: "A" } },
      { kind: "createVendor", ref: "v1", params: { name: "B" } },
      { kind: "createVendor", ref: "v1", params: { name: "C" } },
      { kind: "createVendor", params: { name: "D", phone: "1" } },
      { kind: "moveDevice", params: { device: "PC-1", location: LOC } },
      { kind: "moveDevice", ref: "mv", params: { device: HOST, location: LOC } },
      { kind: "moveDevice", params: { device: HOST, location: { ref: "v1" } } },
    ],
    ctx,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, [
    "Операция 1: неизвестный вид операции «deleteDevice»",
    "Операция 2: ref «V-1» должен быть вида ^[a-z][a-z0-9_]{0,31}$",
    "Операция 4: ref v1 уже есть у операции 3",
    "Операция 5: неизвестный параметр «phone»",
    "Операция 6: параметр «device» — нужен id (24 hex) или ссылка { ref }",
    "Операция 7: операция moveDevice ничего не создаёт — ref не нужен",
    "Операция 8: параметр «location» не принимает ссылку на операцию",
  ]);
});

test("checkPackage: createDevice со ссылкой на createModel проходит, текст говорит «будет создано выше»", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [
      { kind: "createModel", ref: "m1", params: { type: TYPE, vendor: VENDOR, name: "T14" } },
      {
        kind: "createDevice",
        ref: "d1",
        params: {
          deviceModelId: { ref: "m1" },
          companyId: COMPANY,
          locationId: LOC,
          serialNumber: "SN-1",
        },
      },
    ],
    ctx,
  );
  assert.deepEqual(result.reasons, []);
  assert.equal(result.ok, true);
  // createModel без ссылок проверен сервисом с переименованными полями
  assert.deepEqual(called(calls, "checkModel")[0].args[0], {
    deviceTypeId: TYPE,
    vendorId: VENDOR,
    name: "T14",
  });
  // устройство со ссылкой сервисом не проверялось (документа ещё нет)
  assert.equal(called(calls, "checkAgentDevice").length, 0);
  const [model, device] = result.items;
  assert.equal(model.text, "Новая модель Lenovo T14 (Ноутбук)");
  assert.deepEqual(model.targets, [
    { model: "DeviceType", id: TYPE, updatedAt: T1 },
    { model: "Vendor", id: VENDOR, updatedAt: T1 },
  ]);
  assert.equal(device.kind, "createDevice");
  assert.equal(device.ref, "d1");
  assert.match(device.text, /^Новое устройство T14 \(будет создано выше\)/);
  assert.match(device.text, /компания «Ромашка»/);
  assert.match(device.text, /помещение «Кабинет 214»/);
  assert.match(device.text, /серийный номер «SN-1»/);
  // Компания — не цель сверки (не инвентарь), помещение — цель
  assert.deepEqual(device.targets, [{ model: "Location", id: LOC, updatedAt: T1 }]);
  assert.doesNotMatch(device.text, /[0-9a-f]{24}/);
  assert.match(device.text, / — полная проверка при утверждении$/);
  // без ссылок — без пометки
  assert.doesNotMatch(model.text, /полная проверка/);
});

test("checkPackage: ссылка на каталог { ref, key } — только на key из его типов", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const catalog = {
    kind: "catalog",
    ref: "c1",
    params: { types: [{ key: "mono", name: "Моноблок" }] },
  };
  const ok = await checkPackage(
    [catalog, { kind: "createModel", params: { type: { ref: "c1", key: "mono" }, vendor: VENDOR, name: "AIO 24" } }],
    ctx,
  );
  assert.deepEqual(ok.reasons, []);
  assert.equal(ok.items[0].text, "Справочники техники:\nНовый тип «Моноблок» (комплектующая: нет)");
  assert.equal(
    ok.items[1].text,
    "Новая модель «AIO 24»: тип «Моноблок» (будет создано выше), вендор «Lenovo» — полная проверка при утверждении",
  );
  assert.deepEqual(ok.items[1].targets, [{ model: "Vendor", id: VENDOR, updatedAt: T1 }]);
  assert.equal(called(calls, "checkModel").length, 0);

  const bad = await checkPackage(
    [
      catalog,
      { kind: "createModel", params: { type: { ref: "c1", key: "nope" }, vendor: VENDOR, name: "A" } },
      { kind: "createModel", params: { type: { ref: "c1" }, vendor: VENDOR, name: "B" } },
      { kind: "createVendor", ref: "v1", params: { name: "X" } },
      { kind: "createModel", params: { type: TYPE, vendor: { ref: "v1", key: "x" }, name: "C" } },
    ],
    ctx,
  );
  assert.deepEqual(bad.reasons, [
    "Операция 2: в каталоге c1 нет типа с key «nope»",
    "Операция 3: ссылка c1 на каталог — укажите key типа",
    "Операция 5: key бывает только у ссылки на каталог (v1)",
  ]);
});

test("checkPackage: несуществующий id назван полем, без id в тексте; ошибки сервиса с префиксом", async () => {
  const { deps } = fakeDeps({
    deviceOps: {
      checkSetDeviceStatus: async () => ({ ok: false, status: 400, message: "Неизвестный статус «x»" }),
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [
      { kind: "moveDevice", params: { device: MISSING, location: LOC } },
      { kind: "setDeviceStatus", params: { device: HOST, status: "inRepair" } },
    ],
    ctx,
  );
  assert.deepEqual(result.reasons, [
    "Операция 1: не найдено: устройство (параметр «device»)",
    "Операция 2: Неизвестный статус «x»",
  ]);
});

test("checkPackage: неизвестный статус и не-массив operations", async () => {
  const { checkPackage } = createChangeOps(fakeDeps().deps);
  const result = await checkPackage(
    [{ kind: "setDeviceStatus", params: { device: HOST, status: "lost" } }],
    ctx,
  );
  assert.deepEqual(result.reasons, ["Операция 1: неизвестный статус «lost»"]);
  const notList = await checkPackage({ kind: "moveDevice" }, ctx);
  assert.deepEqual(notList, { ok: false, reasons: ["Операции должны быть списком"], items: [] });
});

// ─── Каскад: снимок деталей ─────────────────────────────────────────────────

test("moveDevice: снимок каскада — детали по именам в тексте, в targets и componentIds", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [{ kind: "moveDevice", params: { device: HOST, location: LOC, exceptComponentIds: [MISSING] } }],
    ctx,
  );
  assert.deepEqual(result.reasons, []);
  const [item] = result.items;
  assert.equal(
    item.text,
    "Перенести ПК PC-000123 в «Кабинет 214» вместе с деталями: ОЗУ RAM-000045, SSD SSD-000012",
  );
  assert.deepEqual(item.componentIds, [PART1, PART2]);
  assert.deepEqual(item.targets, [
    { model: "ClientDevice", id: HOST, updatedAt: T1 },
    { model: "Location", id: LOC, updatedAt: T1 },
    { model: "ClientDevice", id: PART1, updatedAt: T2 },
    { model: "ClientDevice", id: PART2, updatedAt: T3 },
  ]);
  const [check] = called(calls, "checkMoveDevice");
  assert.deepEqual(check.args, [
    HOST,
    LOC,
    { actorId: ACTOR, withComponents: true, exceptComponentIds: [MISSING] },
  ]);
});

test("assignDevice: каскад по умолчанию включён; снятие пользователя", async () => {
  const { deps, calls } = fakeDeps({
    deviceOps: { checkAssignUser: async (...args) => (calls.push({ name: "checkAssignUser", args }), { ok: true, device: {}, affected: [] }) },
  });
  const { checkPackage } = createChangeOps(deps);
  // Разными пакетами: в одном пакете вторая операция над тем же ПК отложена до утверждения
  const first = await checkPackage([{ kind: "assignDevice", params: { device: HOST, user: USER } }], ctx);
  const second = await checkPackage([{ kind: "assignDevice", params: { device: HOST, user: null, withComponents: false } }], ctx);
  const result = { reasons: [...first.reasons, ...second.reasons], items: [...first.items, ...second.items] };
  assert.deepEqual(result.reasons, []);
  assert.equal(result.items[0].text, "Выдать ПК PC-000123: Иванова Анна");
  assert.equal(result.items[1].text, "Снять пользователя с ПК PC-000123");
  const checks = called(calls, "checkAssignUser");
  assert.deepEqual(checks[0].args, [HOST, USER, { actorId: ACTOR, withComponents: true, exceptComponentIds: [] }]);
  assert.deepEqual(checks[1].args, [HOST, null, { actorId: ACTOR, withComponents: false, exceptComponentIds: [] }]);
  // пользователь — не цель сверки
  assert.deepEqual(result.items[0].targets, [{ model: "ClientDevice", id: HOST, updatedAt: T1 }]);
});

test("updateDevice / attach / detach / setDeviceStatus: тексты с именами", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  // Каждая операция своим пакетом: в одном пакете операции над тем же ПК после первой отложены
  const packages = await Promise.all(
    [
      { kind: "updateDevice", params: { device: HOST, serialNumber: "SN-9", supplierId: SUPPLIER, comment: null } },
      { kind: "attachComponent", params: { host: HOST, component: PART1 } },
      { kind: "detachComponent", params: { host: HOST, component: PART2 } },
      { kind: "setDeviceStatus", params: { device: HOST, status: "inRepair" } },
      { kind: "updateDevice", params: { device: HOST, companyId: COMPANY } },
    ].map((op) => checkPackage([op], ctx)),
  );
  assert.deepEqual(packages.at(-1).reasons, ["Операция 1: неизвестный параметр «companyId»"]);
  const [update, attach, detach, status] = packages.slice(0, 4).map((p) => p.items[0]);
  assert.equal(
    update.text,
    "Изменить ПК PC-000123: серийный номер → «SN-9», поставщик → «Ситилинк», комментарий — очистить",
  );
  assert.deepEqual(called(calls, "checkPatchDevice")[0].args, [
    HOST,
    { serialNumber: "SN-9", supplierId: SUPPLIER, comment: null },
    { actorId: ACTOR },
  ]);
  assert.equal(attach.text, "Установить ОЗУ RAM-000045 в ПК PC-000123");
  assert.equal(detach.text, "Снять SSD SSD-000012 с ПК PC-000123");
  assert.equal(status.text, "Сменить статус ПК PC-000123 на «В ремонте»");
  assert.deepEqual(attach.targets, [
    { model: "ClientDevice", id: HOST, updatedAt: T1 },
    { model: "ClientDevice", id: PART1, updatedAt: T2 },
  ]);
});

test("createBuild и createConfiguration: поля агента → поля сервиса", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [
      {
        kind: "createBuild",
        params: {
          type: TYPE,
          name: "Офисный",
          parts: [{ type: TYPE, model: MODEL, configuration: CONF, quantity: 2 }],
        },
      },
      {
        kind: "createConfiguration",
        params: { model: MODEL, name: "8/256", values: [{ attribute: "ram_gb", value: 8 }] },
      },
    ],
    ctx,
  );
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(called(calls, "checkBuild")[0].args, [
    {
      deviceTypeId: TYPE,
      name: "Офисный",
      parts: [{ typeId: TYPE, deviceModelId: MODEL, configurationId: CONF, quantity: 2 }],
    },
    { userId: ACTOR },
  ]);
  assert.deepEqual(called(calls, "checkConfiguration")[0].args[0], {
    deviceModelId: MODEL,
    name: "8/256",
    values: [{ attribute: "ram_gb", value: 8 }],
  });
  assert.deepEqual(result.items[1].targets, [{ model: "DeviceModel", id: MODEL, updatedAt: T2 }]);
});

test("createConfiguration со ссылкой на модель: значения по именам атрибутов", async () => {
  const { checkPackage } = createChangeOps(fakeDeps().deps);
  const result = await checkPackage(
    [
      {
        kind: "catalog",
        ref: "c1",
        params: { attributes: [{ key: "ssd", code: "ssd_gb", name: "Объём SSD", valueType: "number" }] },
      },
      { kind: "createModel", ref: "m1", params: { type: TYPE, vendor: VENDOR, name: "T14" } },
      {
        kind: "createConfiguration",
        params: {
          model: { ref: "m1" },
          name: "8/256",
          values: [
            { attribute: "ram_gb", value: 8 },
            { attribute: "ssd_gb", value: 256 },
            { attribute: "color", value: "black" },
          ],
        },
      },
    ],
    ctx,
  );
  assert.deepEqual(result.reasons, []);
  assert.equal(
    result.items[2].text,
    "Новая конфигурация «8/256» для T14 (будет создано выше): Объём ОЗУ 8, Объём SSD 256, color black" +
      " — полная проверка при утверждении",
  );
});

// ─── Применение ─────────────────────────────────────────────────────────────

test("applyPackage: id созданной модели подставляется в устройство", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "createModel", ref: "m1", params: { type: TYPE, vendor: VENDOR, name: "T14" } },
      { kind: "createDevice", params: { deviceModelId: { ref: "m1" }, companyId: COMPANY } },
    ],
    ctx,
  );
  assert.equal(checked.ok, true);
  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  assert.deepEqual(applied.results, [
    { state: "done", created: { model: NEW_MODEL } },
    { state: "done", created: { device: NEW_DEVICE } },
  ]);
  // перед записью — повторная проверка уже с настоящим id
  const [recheck] = called(calls, "checkAgentDevice");
  assert.deepEqual(recheck.args[0], { deviceModelId: NEW_MODEL, companyId: COMPANY });
  const [create] = called(calls, "createAgentDevice");
  assert.deepEqual(create.args, [{ deviceModelId: NEW_MODEL, companyId: COMPANY }, { userId: ACTOR }]);
  assert.deepEqual(called(calls, "createModel")[0].args, [
    { deviceTypeId: TYPE, vendorId: VENDOR, name: "T14" },
    { userId: ACTOR },
  ]);
  // исходные параметры пакета не тронуты
  assert.deepEqual(checked.items[1].params.deviceModelId, { ref: "m1" });
});

test("applyPackage: ключ каталога { ref, key } → catalogIds.types[key]", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "catalog", ref: "c1", params: { types: [{ key: "mono", name: "Моноблок" }] } },
      { kind: "createModel", params: { type: { ref: "c1", key: "mono" }, vendor: VENDOR, name: "AIO" } },
    ],
    ctx,
  );
  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  assert.deepEqual(applied.results[0].created, { type: { mono: NEW_TYPE }, attribute: {}, group: {} });
  assert.equal(called(calls, "createModel")[0].args[0].deviceTypeId, NEW_TYPE);
  assert.deepEqual(called(calls, "applyCatalogPatch")[0].args, [
    { types: [{ key: "mono", name: "Моноблок" }] },
    { userId: ACTOR },
  ]);
});

test("applyPackage: сбой на 2-й из 3 → partial, 3-я пропущена", async () => {
  const { deps, calls } = fakeDeps({
    deviceOps: {
      moveDevice: async () => ({ ok: false, status: 409, message: "Деталь «RAM-000045» уже не в составе устройства" }),
    },
  });
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "createVendor", params: { name: "Lenovo" } },
      { kind: "moveDevice", params: { device: HOST, location: LOC } },
      { kind: "setDeviceStatus", params: { device: HOST, status: "inRepair" } },
    ],
    ctx,
  );
  const reported = [];
  const onResult = async (index, result) => {
    // До следующей операции: между двумя итогами сервисов позвали ещё (проверка и запись переноса)
    reported.push([index, result.state, calls.length]);
  };
  const applied = await applyPackage(checked.items, { ...ctx, onResult });
  assert.equal(applied.status, "partial");
  assert.deepEqual(applied.results, [
    { state: "done", created: { vendor: NEW_VENDOR } },
    { state: "failed", error: "Деталь «RAM-000045» уже не в составе устройства" },
    { state: "skipped" },
  ]);
  assert.equal(called(calls, "setDeviceStatus").length, 0);
  // Ход: по итогу на выполненную операцию (done, failed), пропущенная — без записи
  assert.deepEqual(reported.map(([index, state]) => [index, state]), [[0, "done"], [1, "failed"]]);
  assert.ok(reported[1][2] > reported[0][2]);
  // onResult в операции не уходит
  assert.ok(calls.every((c) => !c.args.some((a) => a && typeof a === "object" && "onResult" in a)));
});

test("applyPackage: каскад ровно по снимку, повторная проверка с тем же списком", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [{ kind: "moveDevice", params: { device: HOST, location: LOC, exceptComponentIds: [MISSING] } }],
    ctx,
  );
  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  const options = { actorId: ACTOR, withComponents: true, componentIds: [PART1, PART2] };
  assert.deepEqual(called(calls, "checkMoveDevice")[1].args, [HOST, LOC, options]);
  assert.deepEqual(called(calls, "moveDevice")[0].args, [HOST, LOC, options]);
});

test("applyPackage: провал повторной проверки на 1-й → failed, записи нет", async () => {
  let n = 0;
  const { deps, calls } = fakeDeps({
    catalogOps: {
      checkVendor: async () =>
        ++n === 1
          ? { ok: true, text: "Новый вендор «Lenovo»" }
          : { ok: false, status: 409, message: 'Vendor with name "Lenovo" already exists', text: "" },
    },
  });
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "createVendor", params: { name: "Lenovo" } },
      { kind: "setDeviceStatus", params: { device: HOST, status: "inRepair" } },
    ],
    ctx,
  );
  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "failed");
  assert.deepEqual(applied.results, [
    { state: "failed", error: "Вендор «Lenovo» уже есть" },
    { state: "skipped" },
  ]);
  assert.equal(called(calls, "createVendor").length, 0);
});

test("applyPackage: исключение сервиса — сбой операции, а не всего вызова", async () => {
  const { deps, calls } = fakeDeps({
    deviceOps: {
      setDeviceStatus: async () => {
        throw new Error("boom");
      },
    },
  });
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [{ kind: "setDeviceStatus", params: { device: HOST, status: "inRepair" } }],
    ctx,
  );
  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "failed");
  assert.equal(applied.results[0].state, "failed");
  // людям — общий текст, оригинал — в журнал
  assert.equal(applied.results[0].error, "Не удалось выполнить операцию");
  const [log] = called(calls, "log");
  assert.equal(log.args[2].error, "boom");
});

// ─── Ошибки для людей ───────────────────────────────────────────────────────

test("ошибки сервисов: дубли по-русски с именем, 500 с id — общий текст и журнал", async () => {
  const { deps, calls } = fakeDeps({
    catalogOps: {
      checkVendor: async () => ({ ok: false, status: 409, message: 'Vendor with name "Lenovo" already exists', text: "" }),
      checkModel: async () => ({
        ok: false,
        status: 409,
        message: 'Device model with name "T14" already exists',
        text: "",
      }),
    },
    deviceOps: {
      checkMoveDevice: async () => ({ ok: false, status: 500, message: `Failed to move device ${HOST}` }),
      checkSetDeviceStatus: async () => ({ ok: false, status: 404, message: `Device with id ${HOST} not found` }),
      checkAssignUser: async () => ({ ok: false, status: 400, message: "Assigned user must belong to the same company" }),
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [
      { kind: "createVendor", params: { name: "Lenovo" } },
      { kind: "createModel", params: { type: TYPE, vendor: VENDOR, name: "T14" } },
      { kind: "moveDevice", params: { device: HOST, location: LOC } },
      { kind: "setDeviceStatus", params: { device: HOST, status: "inRepair" } },
      { kind: "assignDevice", params: { device: HOST, user: USER } },
    ],
    ctx,
  );
  assert.deepEqual(result.reasons, [
    "Операция 1: Вендор «Lenovo» уже есть",
    "Операция 2: Модель «T14» уже есть",
    "Операция 3: Не удалось выполнить операцию",
    "Операция 4: Устройство не найдено",
    "Операция 5: Человек не из компании устройства",
  ]);
  const logs = called(calls, "log");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].args[2].message, `Failed to move device ${HOST}`);
});

test("исключение при проверке пакета — причина без подробностей", async () => {
  const { deps } = fakeDeps({
    deviceOps: {
      checkMoveDevice: async () => {
        throw new Error(`cast failed for ${HOST}`);
      },
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage([{ kind: "moveDevice", params: { device: HOST, location: LOC } }], ctx);
  assert.deepEqual(result.reasons, ["Операция 1: Не удалось выполнить операцию"]);
});

test("applyPackage: причины без имён параметров и ссылок", async () => {
  const { deps } = fakeDeps();
  const { applyPackage } = createChangeOps(deps);
  const missing = await applyPackage(
    [{ kind: "createConfiguration", ref: null, params: { model: MISSING, name: "x" }, text: "", targets: [] }],
    ctx,
  );
  assert.deepEqual(missing.results, [{ state: "failed", error: "модель не найдена" }]);
  const unresolved = await applyPackage(
    [{ kind: "createDevice", ref: null, params: { deviceModelId: { ref: "m1" } }, text: "", targets: [] }],
    ctx,
  );
  assert.deepEqual(unresolved.results, [{ state: "failed", error: "не создано на предыдущем шаге" }]);
});

// ─── Типы простых полей ─────────────────────────────────────────────────────

test("простые поля типизированы: операторы Mongo и объекты не проходят", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [
      { kind: "createDevice", params: { deviceModelId: MODEL, companyId: COMPANY, inventoryNumber: { $regex: "^PC" } } },
      { kind: "createDevice", params: { deviceModelId: MODEL, companyId: COMPANY, purchasedAt: true, price: "abc" } },
      {
        kind: "createDevice",
        params: { deviceTypeId: TYPE, companyId: COMPANY, parts: [{ typeId: TYPE, deviceModelId: MODEL, serialNumber: ["a"] }] },
      },
      { kind: "updateDevice", params: { device: HOST, warrantyExpirationDate: "31.12.2027", comment: { a: 1 } } },
      { kind: "createVendor", params: { name: { $ne: null } } },
      { kind: "setDeviceStatus", params: { device: HOST, status: { $ne: "x" }, withComponents: "yes" } },
      { kind: "createConfiguration", params: { model: MODEL, name: "x", values: [{ attribute: "ram_gb", value: { a: 1 } }] } },
      { kind: "catalog", params: { types: "laptop" } },
    ],
    ctx,
  );
  assert.deepEqual(result.reasons, [
    "Операция 1: параметр «inventoryNumber» — строка",
    "Операция 2: параметр «purchasedAt» — дата (YYYY-MM-DD)",
    "Операция 2: параметр «price» — число",
    "Операция 3: параметр «parts[0].serialNumber» — строка",
    "Операция 4: параметр «warrantyExpirationDate» — дата (YYYY-MM-DD)",
    "Операция 4: параметр «comment» — строка",
    "Операция 5: параметр «name» — строка",
    "Операция 6: параметр «status» — строка",
    "Операция 6: параметр «withComponents» — да или нет (true/false)",
    "Операция 7: параметр «values[0].value» — строка, число или список",
    "Операция 8: параметр «types» — список",
  ]);
  // до сервисов (и findOne) ничего не дошло
  assert.equal(called(calls, "checkAgentDevice").length, 0);
  assert.equal(called(calls, "checkPatchDevice").length, 0);

  const ok = await checkPackage(
    [
      {
        kind: "createDevice",
        params: {
          deviceModelId: MODEL,
          companyId: COMPANY,
          purchasedAt: "2026-10-01",
          warrantyExpirationDate: "2027-10-01T00:00:00.000Z",
          price: "1500.50",
          quantity: 1,
        },
      },
    ],
    ctx,
  );
  assert.deepEqual(ok.reasons, []);
});

// ─── Финальная волна правок фазы 2 ──────────────────────────────────────────

test("устройство, которое меняет более ранняя операция: проверка отложена до применения, оба шага применяются", async () => {
  // Деталь PART1 стоит в HOST: поставить её в PART2 до снятия нельзя — сервис отказал бы при предложении
  let detached = false;
  const { deps, calls } = fakeDeps({
    deviceOps: {
      checkAttachComponent: async (...args) => {
        calls.push({ name: "checkAttachComponent", args });
        return detached
          ? { ok: true, device: {}, affected: [PART1] }
          : { ok: false, status: 409, message: "Устройство уже входит в другую сборку" };
      },
      detachComponent: async (...args) => {
        calls.push({ name: "detachComponent", args });
        detached = true;
        return { ok: true, device: {}, affected: [PART1] };
      },
    },
  });
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "detachComponent", params: { host: HOST, component: PART1 } },
      { kind: "attachComponent", params: { host: PART2, component: PART1 } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  assert.equal(checked.ok, true);
  // при предложении сервис второй операции не спрашивали
  assert.equal(called(calls, "checkAttachComponent").length, 0);
  assert.equal(checked.items[0].text, "Снять ОЗУ RAM-000045 с ПК PC-000123");
  assert.equal(checked.items[1].text, "Установить ОЗУ RAM-000045 в SSD SSD-000012 — полная проверка при утверждении");
  // снимок сверки — состояние до пакета
  assert.deepEqual(checked.items[1].targets, [
    { model: "ClientDevice", id: PART2, updatedAt: T3 },
    { model: "ClientDevice", id: PART1, updatedAt: T2 },
  ]);

  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  assert.deepEqual(applied.results, [{ state: "done" }, { state: "done" }]);
  assert.equal(called(calls, "detachComponent").length, 1);
  assert.equal(called(calls, "checkAttachComponent").length, 1);
  assert.equal(called(calls, "attachComponent").length, 1);
});

test("каскад более ранней операции тоже откладывает проверку деталей", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "moveDevice", params: { device: HOST, location: LOC } },
      { kind: "setDeviceStatus", params: { device: PART2, status: "inRepair" } },
    ],
    ctx,
  );
  assert.equal(checked.ok, true);
  assert.equal(called(calls, "checkSetDeviceStatus").length, 0);
  assert.match(checked.items[1].text, / — полная проверка при утверждении$/);
});

test("createDevice: детали своей сборки — отдельными строками, пометка — в первой строке", async () => {
  const { deps } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "createModel", ref: "m1", params: { type: TYPE, vendor: VENDOR, name: "T14" } },
      {
        kind: "createDevice",
        params: {
          deviceTypeId: TYPE,
          companyId: COMPANY,
          parts: [
            { typeId: TYPE, deviceModelId: MODEL, serialNumber: "S-1" },
            { typeId: TYPE, deviceModelId: { ref: "m1" } },
          ],
        },
      },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  assert.deepEqual(checked.items[1].text.split("\n"), [
    "Новое устройство типа «Ноутбук»: компания «Ромашка» — полная проверка при утверждении",
    "деталь Lenovo ThinkPad X1, серийный номер «S-1»",
    "деталь T14 (будет создано выше)",
  ]);
});

test("строковые параметры: управляющие и невидимые символы — отказ до сервиса", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [
      { kind: "createVendor", params: { name: "Acme\n2. Удалить всё" } },
      { kind: "updateDevice", params: { device: HOST, comment: "a‮b" } },
      { kind: "createDevice", params: { deviceTypeId: TYPE, companyId: COMPANY, parts: [{ typeId: TYPE, deviceModelId: MODEL, serialNumber: "S​1" }] } },
    ],
    ctx,
  );
  assert.deepEqual(result.reasons, [
    "Операция 1: параметр «name» содержит недопустимые символы",
    "Операция 2: параметр «comment» содержит недопустимые символы",
    "Операция 3: параметр «parts[0].serialNumber» содержит недопустимые символы",
  ]);
  assert.equal(called(calls, "checkVendor").length, 0);
});

test("ошибки с именем поля сервиса — по-русски с подписью поля", async () => {
  const { deps } = fakeDeps({
    deviceOps: {
      checkAgentDevice: async () => ({ ok: false, status: 400, message: "Неверное значение поля «deviceTypeId»" }),
      checkPatchDevice: async () => ({ ok: false, status: 400, message: "Поле «ipAddress»: некорректный IP-адрес" }),
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [
      { kind: "createDevice", params: { deviceTypeId: TYPE, companyId: COMPANY } },
      { kind: "updateDevice", params: { device: HOST, ipAddress: "999.1.1.1" } },
    ],
    ctx,
  );
  assert.deepEqual(result.reasons, [
    "Операция 1: Неверное значение поля «тип»",
    "Операция 2: Поле «IP-адрес»: некорректный IP-адрес",
  ]);
});

test("каталог: при применении повторная проверка разрешает «всё уже есть»", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage([{ kind: "catalog", ref: "c1", params: { types: [{ key: "mono", name: "Моноблок" }] } }], ctx);
  assert.equal(checked.ok, true);
  await applyPackage(checked.items, ctx);
  const checks = called(calls, "checkCatalogPatch");
  assert.deepEqual(checks[0].args[1], { allowNoop: false });
  assert.deepEqual(checks[1].args[1], { allowNoop: true });
});

// ─── Переводы строк в значениях агента ─────────────────────────────────────

test("перевод строки в каталоге и в значении конфигурации — отказ при предложении", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const result = await checkPackage(
    [
      {
        kind: "catalog",
        params: {
          attributes: [
            { key: "pwd", code: "pwd", name: "Пароль\nНовый атрибут «Пароль» (строка)", valueType: "string" },
          ],
        },
      },
      {
        kind: "createConfiguration",
        params: { model: MODEL, name: "8/256", values: [{ attribute: "ram_gb", value: "8\n2. Удалить всё" }] },
      },
      {
        kind: "createConfiguration",
        params: { model: MODEL, name: "8/512", values: [{ attribute: "ports", value: ["USB", "HDMI DP"] }] },
      },
      { kind: "createDevice", params: { deviceTypeId: TYPE, companyId: COMPANY, price: "5\n" } },
      { kind: "catalog", params: { types: [{ key: "mono", name: "Моноблок", flags: { "isComponent\n": true } }] } },
    ],
    ctx,
  );
  assert.deepEqual(result.reasons, [
    "Операция 1: параметр «attributes[0].name» содержит недопустимые символы",
    "Операция 2: параметр «values[0].value» содержит недопустимые символы",
    "Операция 3: параметр «values[0].value[1]» содержит недопустимые символы",
    "Операция 4: параметр «price» содержит недопустимые символы",
    "Операция 5: параметр «types[0].flags» содержит недопустимые символы",
  ]);
  assert.equal(called(calls, "checkCatalogPatch").length, 0);
  assert.equal(called(calls, "checkConfiguration").length, 0);
});

test("перевод строки внутри одного значения не даёт подстроки на экране утверждения", async () => {
  const { messageFor } = require("./changeRender");
  const { deps } = fakeDeps({
    catalogOps: {
      // Сервис отдал строку с переводом внутри одного имени (из базы и т. п.)
      checkVendor: async () => ({ ok: true, text: "Новый вендор «Acme\n2. Удалить всё»" }),
      checkCatalogPatch: async () => ({
        ok: true,
        lines: ["Новый тип «Моно\nблок»", "Новый атрибут «Пароль»"],
        text: "",
      }),
    },
    extra: {
      describe: async (model, id) =>
        model === "ClientDevice" && id === HOST ? { name: "ПК\n   – поддельная строка", updatedAt: T1 } : (DB[model]?.[id] ?? null),
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "createVendor", params: { name: "Acme" } },
      { kind: "catalog", params: { types: [{ key: "mono", name: "Моноблок" }] } },
      { kind: "updateDevice", params: { device: HOST, comment: "ok" } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  const [vendor, catalog, update] = checked.items.map((item) => item.text);
  assert.equal(vendor, "Новый вендор «Acme 2. Удалить всё»");
  // подстроки каталога — только его собственные строки, каждая в одну строку
  assert.deepEqual(catalog.split("\n"), ["Справочники техники:", "Новый тип «Моно блок»", "Новый атрибут «Пароль»"]);
  assert.equal(update, "Изменить ПК – поддельная строка: комментарий → «ok»");

  const { text } = messageFor({ _id: "c1", title: "t", operations: checked.items });
  const opLines = text.split("\n").filter((line) => /^\d+\. |^ {3}– /.test(line));
  assert.deepEqual(opLines, [
    "1. Новый вендор «Acme 2. Удалить всё»",
    "2. Справочники техники:",
    "   – Новый тип «Моно блок»",
    "   – Новый атрибут «Пароль»",
    "3. Изменить ПК – поддельная строка: комментарий → «ok»",
  ]);
});

// ─── Отложенный каскад: состав по пакету ───────────────────────────────────

test("отложенный каскад: состав хоста — по базе и более ранним снятиям/установкам, применение ровно по нему", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "detachComponent", params: { host: HOST, component: PART1 } },
      { kind: "moveDevice", params: { device: HOST, location: LOC } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  const move = checked.items[1];
  assert.equal(
    move.text,
    "Перенести ПК PC-000123 в «Кабинет 214» вместе с деталями: SSD SSD-000012 — полная проверка при утверждении",
  );
  assert.deepEqual(move.componentIds, [PART2]);
  assert.equal(move.componentRefs, undefined);
  assert.deepEqual(move.targets, [
    { model: "ClientDevice", id: HOST, updatedAt: T1 },
    { model: "Location", id: LOC, updatedAt: T1 },
    { model: "ClientDevice", id: PART2, updatedAt: T3 },
  ]);
  // сервис отложенной операции при предложении не спрашивали
  assert.equal(called(calls, "checkMoveDevice").length, 0);

  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  const options = { actorId: ACTOR, withComponents: true, componentIds: [PART2] };
  assert.deepEqual(called(calls, "checkMoveDevice")[0].args, [HOST, LOC, options]);
  assert.deepEqual(called(calls, "moveDevice")[0].args, [HOST, LOC, options]);
});

test("отложенный каскад: новая деталь пакета — ссылкой, при применении её id дописан к снимку", async () => {
  const OTHER = "aaaaaaaaaaaaaaaaaaaaaaa9";
  const { deps, calls } = fakeDeps({
    deviceOps: {
      createAgentDevice: async (...args) => {
        calls.push({ name: "createAgentDevice", args });
        return { ok: true, device: { _id: args[0].serialNumber === "S-2" ? OTHER : NEW_DEVICE }, parts: [] };
      },
    },
    extra: {
      // созданное при применении «база» тоже находит
      describe: async (model, id) =>
        model === "ClientDevice" && [NEW_DEVICE, OTHER].includes(id)
          ? { name: "новое", updatedAt: T3 }
          : (DB[model]?.[id] ?? null),
    },
  });
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "createDevice", ref: "ram", params: { deviceModelId: MODEL, parentDeviceId: HOST, serialNumber: "S-1" } },
      { kind: "createDevice", ref: "ssd", params: { deviceTypeId: TYPE, companyId: COMPANY, serialNumber: "S-2" } },
      { kind: "attachComponent", params: { host: HOST, component: { ref: "ssd" } } },
      { kind: "setDeviceStatus", params: { device: HOST, status: "inRepair", exceptComponentIds: [PART1] } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  const status = checked.items[3];
  assert.equal(
    status.text,
    "Сменить статус ПК PC-000123 на «В ремонте» вместе с деталями: SSD SSD-000012, " +
      "новая деталь Lenovo ThinkPad X1 «S-1», новая деталь Ноутбук «S-2» — полная проверка при утверждении",
  );
  assert.deepEqual(status.componentIds, [PART2]);
  assert.deepEqual(status.componentRefs, ["ram", "ssd"]);

  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  const options = { actorId: ACTOR, withComponents: true, componentIds: [PART2, NEW_DEVICE, OTHER] };
  assert.deepEqual(called(calls, "setDeviceStatus")[0].args, [HOST, "inRepair", options]);
});

test("отложенный каскад: новая деталь без ref — состав определится при утверждении; без каскада — без хвоста", async () => {
  const { deps } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "createDevice", params: { deviceModelId: MODEL, parentDeviceId: HOST } },
      { kind: "moveDevice", params: { device: HOST, location: LOC } },
      { kind: "assignDevice", params: { device: HOST, user: USER, withComponents: false } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  const [, move, assign] = checked.items;
  assert.equal(
    move.text,
    "Перенести ПК PC-000123 в «Кабинет 214» вместе со всеми деталями — полная проверка при утверждении",
  );
  assert.equal(move.componentIds, undefined);
  assert.equal(assign.text, "Выдать ПК PC-000123: Иванова Анна — полная проверка при утверждении");
  assert.equal(assign.componentIds, undefined);
});

test("каскад хоста-ссылки: состав определится при утверждении", async () => {
  const { deps } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "createDevice", ref: "pc", params: { deviceTypeId: TYPE, companyId: COMPANY } },
      { kind: "moveDevice", params: { device: { ref: "pc" }, location: LOC } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  assert.equal(
    checked.items[1].text,
    "Перенести новое устройство (будет создано выше) в «Кабинет 214» вместе со всеми деталями — полная проверка при утверждении",
  );
});

test("отложенный каскад: деталь переезжает между двумя хостами пакета — состав верен у обоих", async () => {
  const HOST2 = "aaaaaaaaaaaaaaaaaaaaaab1";
  const PART3 = "aaaaaaaaaaaaaaaaaaaaaab2";
  const { deps, calls } = fakeDeps({
    extra: {
      liveParts: async (hostId) => (hostId === HOST ? [PART1, PART2] : hostId === HOST2 ? [PART3] : []),
      describe: async (model, id) =>
        model === "ClientDevice" && id === HOST2
          ? { name: "ПК PC-000999", updatedAt: T1 }
          : model === "ClientDevice" && id === PART3
            ? { name: "HDD HDD-000007", updatedAt: T2 }
            : (DB[model]?.[id] ?? null),
    },
  });
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "detachComponent", params: { host: HOST, component: PART1 } },
      { kind: "attachComponent", params: { host: HOST2, component: PART1 } },
      { kind: "moveDevice", params: { device: HOST, location: LOC } },
      { kind: "moveDevice", params: { device: HOST2, location: LOC } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  assert.deepEqual(checked.items[2].componentIds, [PART2]);
  assert.deepEqual(checked.items[3].componentIds, [PART3, PART1]);
  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  const moves = called(calls, "moveDevice");
  assert.deepEqual(moves[0].args, [HOST, LOC, { actorId: ACTOR, withComponents: true, componentIds: [PART2] }]);
  assert.deepEqual(moves[1].args, [HOST2, LOC, { actorId: ACTOR, withComponents: true, componentIds: [PART3, PART1] }]);
});

test("id в верхнем регистре приводятся к нижнему: снятие и каскад видят одну и ту же деталь", async () => {
  const { deps, calls } = fakeDeps();
  const { checkPackage, applyPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "detachComponent", params: { host: HOST.toUpperCase(), component: PART1.toUpperCase() } },
      { kind: "moveDevice", params: { device: HOST.toUpperCase(), location: LOC } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  assert.deepEqual(checked.items[0].params, { host: HOST, component: PART1 });
  assert.deepEqual(checked.items[1].componentIds, [PART2]);
  const applied = await applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  assert.deepEqual(called(calls, "moveDevice")[0].args[2].componentIds, [PART2]);
});

test("createDevice в составе хоста: компания, помещение, пользователь и статус — как у хоста", async () => {
  const { deps } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [{ kind: "createDevice", params: { deviceModelId: MODEL, parentDeviceId: HOST, companyId: COMPANY, serialNumber: "S-1" } }],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  assert.equal(
    checked.items[0].text,
    "Новое устройство Lenovo ThinkPad X1: в составе ПК PC-000123 " +
      "(компания, помещение, пользователь и статус — как у хоста), серийный номер «S-1»",
  );
});

test("применение: новая деталь каскада не создана — сбой операции, сервис не зовётся", async () => {
  const { deps, calls } = fakeDeps();
  const { applyPackage } = createChangeOps(deps);
  const applied = await applyPackage(
    [{ kind: "moveDevice", params: { device: HOST, location: LOC }, targets: [], componentIds: [PART2], componentRefs: ["ghost"] }],
    ctx,
  );
  assert.equal(applied.status, "failed");
  assert.deepEqual(applied.results, [{ state: "failed", error: "не создано на предыдущем шаге" }]);
  assert.equal(called(calls, "moveDevice").length, 0);
});

// ─── Вид операции для страницы портала (page) ──────────────────────────────

test("page: createDevice — заголовок без полей, поля табличкой, «выдаст HD»", async () => {
  const { deps } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      {
        kind: "createDevice",
        params: { deviceTypeId: SYS_TYPE, companyId: COMPANY2, locationId: LOC, status: "readyForDeployment", serialNumber: "PF4XK2L9" },
      },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  // Текст Telegram не сдвинулся
  assert.equal(
    item.text,
    "Новое устройство типа «Системный блок»: компания «ООО Ромашка и партнёры», помещение «Кабинет 214», " +
      "статус «Готово к выдаче», серийный номер «PF4XK2L9»",
  );
  assert.equal(item.page.head, "Новое устройство типа «Системный блок»");
  assert.deepEqual(item.page.subs, []);
  assert.equal(item.page.deferred, false);
  assert.deepEqual(item.page.fields, [
    { label: "компания", value: "ООО Ромашка и партнёры" },
    { label: "помещение", value: "Кабинет 214" },
    { label: "статус", value: "Готово к выдаче" },
    { label: "серийный номер", value: "PF4XK2L9" },
    { label: "инвентарный номер", value: "выдаст HD" },
  ]);
  assert.deepEqual(item.page.links, [
    { model: "DeviceType", id: SYS_TYPE, label: "«Системный блок»" },
    { model: "Company", id: COMPANY2, label: "«ООО Ромашка и партнёры»" },
    { model: "Location", id: LOC, label: "«Кабинет 214»" },
  ]);

  // Модель и конфигурация — в заголовке, детали своей сборки — подстроками,
  // заданный инвентарный номер — на своём месте
  const built = await checkPackage(
    [
      {
        kind: "createDevice",
        params: {
          deviceModelId: MODEL,
          configurationId: CONF,
          companyId: COMPANY,
          inventoryNumber: "PC-000200",
          parts: [{ typeId: TYPE, deviceModelId: MODEL, serialNumber: "S-1" }],
        },
      },
    ],
    ctx,
  );
  assert.deepEqual(built.reasons, []);
  const [pc] = built.items;
  assert.equal(pc.page.head, "Новое устройство Lenovo ThinkPad X1, конфигурация «16/512»");
  assert.deepEqual(pc.page.subs, ["деталь Lenovo ThinkPad X1, серийный номер «S-1»"]);
  assert.deepEqual(pc.page.fields, [
    { label: "компания", value: "Ромашка" },
    { label: "инвентарный номер", value: "PC-000200" },
  ]);
});

test("page: updateDevice — было → стало", async () => {
  const { deps, calls } = fakeDeps({
    deviceOps: {
      checkPatchDevice: async (...args) => {
        calls.push({ name: "checkPatchDevice", args });
        return {
          ok: true,
          device: {},
          affected: [HOST],
          before: { serialNumber: "SN-1", supplierId: OLD_SUPPLIER, comment: "старый комментарий" },
        };
      },
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [{ kind: "updateDevice", params: { device: HOST, serialNumber: "SN-9", supplierId: SUPPLIER, comment: null } }],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(
    item.text,
    "Изменить ПК PC-000123: серийный номер → «SN-9», поставщик → «Ситилинк», комментарий — очистить",
  );
  assert.equal(item.page.head, "Изменить ПК PC-000123");
  assert.deepEqual(item.page.fields, [
    { label: "серийный номер", value: "SN-9", before: "SN-1" },
    { label: "поставщик", value: "Ситилинк", before: "Регард" },
    { label: "комментарий", value: "очистить", before: "старый комментарий" },
  ]);
});

test("page: updateDevice — прежняя дата днём, пустое прежнее значение без before", async () => {
  const { deps } = fakeDeps({
    deviceOps: {
      checkPatchDevice: async () => ({
        ok: true,
        device: {},
        affected: [HOST],
        before: { purchasedAt: new Date("2025-03-04T00:00:00Z"), price: 1200, hostname: undefined },
      }),
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [{ kind: "updateDevice", params: { device: HOST, purchasedAt: "2026-01-02", price: 900, hostname: "pc-01" } }],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  assert.deepEqual(checked.items[0].page.fields, [
    { label: "имя в сети", value: "pc-01" },
    { label: "дата покупки", value: "2026-01-02", before: "2025-03-04" },
    { label: "цена", value: "900", before: "1200" },
  ]);
});

test("page: setDeviceStatus — статус было → стало, каскад в заголовке", async () => {
  const { deps } = fakeDeps({
    deviceOps: {
      checkSetDeviceStatus: async () => ({ ok: true, device: {}, affected: CASCADE, before: { status: "deployed" } }),
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage([{ kind: "setDeviceStatus", params: { device: HOST, status: "inRepair" } }], ctx);
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(
    item.text,
    "Сменить статус ПК PC-000123 на «В ремонте» вместе с деталями: ОЗУ RAM-000045, SSD SSD-000012",
  );
  assert.equal(item.page.head, item.text);
  assert.deepEqual(item.page.fields, [{ label: "статус", value: "В ремонте", before: "В эксплуатации" }]);
});

test("page: ссылки — подписи совпадают с текстом", async () => {
  const { deps } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  // id в верхнем регистре: в ссылке — как в params (нижний)
  const checked = await checkPackage(
    [{ kind: "moveDevice", params: { device: HOST.toUpperCase(), location: LOC } }],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  const { page } = checked.items[0];
  assert.deepEqual(page.links, [
    { model: "ClientDevice", id: HOST, label: "ПК PC-000123" },
    { model: "Location", id: LOC, label: "«Кабинет 214»" },
  ]);
  for (const link of page.links) assert.ok(page.head.includes(link.label), link.label);
  assert.deepEqual(page.fields, []);
});

test("page: ссылки — имя из базы с переводом строки схлопнуто так же, как в тексте", async () => {
  const { deps } = fakeDeps({
    extra: {
      describe: async (model, id) =>
        model === "ClientDevice" && id === HOST ? { name: "ПК\n   PC-1", updatedAt: T1 } : (DB[model]?.[id] ?? null),
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage([{ kind: "detachComponent", params: { host: HOST, component: PART2 } }], ctx);
  const { page, text } = checked.items[0];
  assert.equal(text, "Снять SSD SSD-000012 с ПК PC-1");
  assert.deepEqual(
    page.links.map((link) => link.label),
    ["ПК PC-1", "SSD SSD-000012"],
  );
  for (const link of page.links) assert.ok(page.head.includes(link.label), link.label);
});

test("page: отложенная операция — пометка не в заголовке, deferred true", async () => {
  const { deps } = fakeDeps();
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage(
    [
      { kind: "createVendor", ref: "v1", params: { name: "Acme" } },
      { kind: "createModel", ref: "m1", params: { type: TYPE, vendor: { ref: "v1" }, name: "X5" } },
      { kind: "detachComponent", params: { host: HOST, component: PART1 } },
      { kind: "attachComponent", params: { host: PART2, component: PART1 } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  const [vendor, model, , attach] = checked.items;
  assert.equal(vendor.page.deferred, false);
  assert.equal(model.text, "Новая модель «X5»: тип «Ноутбук», вендор «Acme» (будет создано выше) — полная проверка при утверждении");
  assert.equal(model.page.head, "Новая модель «X5»: тип «Ноутбук», вендор «Acme» (будет создано выше)");
  assert.equal(model.page.deferred, true);
  // Создаваемое пакетом — не ссылка: открывать ещё нечего
  assert.deepEqual(model.page.links, [{ model: "DeviceType", id: TYPE, label: "«Ноутбук»" }]);
  assert.equal(attach.page.head, "Установить ОЗУ RAM-000045 в SSD SSD-000012");
  assert.equal(attach.page.deferred, true);
  assert.doesNotMatch(attach.page.head, /полная проверка/);
});

test("page: по умолчанию — заголовок и подстроки из текста", async () => {
  const { deps } = fakeDeps({
    catalogOps: {
      checkCatalogPatch: async () => ({
        ok: true,
        lines: ["Новый тип «Док-станция» (комплектующая: нет)", "Новый атрибут «Порты USB-C» (число) у типа «Док-станция»"],
        text: "",
      }),
    },
  });
  const { checkPackage } = createChangeOps(deps);
  const checked = await checkPackage([{ kind: "catalog", params: { types: [{ key: "dock", name: "Док-станция" }] } }], ctx);
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(item.text.split("\n")[0], "Справочники техники:");
  assert.deepEqual(item.page, {
    head: "Справочники техники",
    subs: ["Новый тип «Док-станция» (комплектующая: нет)", "Новый атрибут «Порты USB-C» (число) у типа «Док-станция»"],
    fields: [],
    links: [],
    deferred: false,
  });
});

// ─── Правка каталога: вендор, поставщик, модель, тип, группа ───────────────

const editCheck = async (operations, overrides) => {
  const made = fakeDeps(overrides);
  const checked = await createChangeOps(made.deps).checkPackage(operations, ctx);
  return { ...made, checked };
};

test("requiredRights: правки каталога — по утверждению на вид, без повторов", () => {
  const { requiredRights } = createChangeOps(fakeDeps().deps);
  assert.deepEqual(
    requiredRights([{ kind: "updateVendor", params: {} }, { kind: "updateSupplier", params: {} }, { kind: "updateGroup", params: {} }]),
    [{ inventoryCatalog: ["manage"] }, { supplier: ["manage"] }],
  );
});

test("uniqueStatements: right-массив — все утверждения, без повторов, порядок появления", () => {
  assert.deepEqual(
    uniqueStatements([{ device: ["manage"] }, [{ inventoryCatalog: ["manage"] }, { device: ["manage"] }], { supplier: ["manage"] }]),
    [{ device: ["manage"] }, { inventoryCatalog: ["manage"] }, { supplier: ["manage"] }],
  );
});

test("updateVendor: текст, было → стало, право", async () => {
  const { checked, calls } = await editCheck(
    [{ kind: "updateVendor", params: { id: VENDOR, name: "Lenovo Group" } }],
    { catalogEditOps: { checkUpdateVendor: async (args, opts) => ({ ok: true, before: { name: "Lenovo" }, args, opts }) } },
  );
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(item.text, "Изменить вендора «Lenovo»: название → «Lenovo Group»");
  assert.equal(item.page.head, "Изменить вендора «Lenovo»");
  assert.deepEqual(item.page.fields, [{ label: "название", value: "Lenovo Group", before: "Lenovo" }]);
  assert.deepEqual(item.targets, [{ model: "Vendor", id: VENDOR, updatedAt: T1 }]);
  assert.equal(called(calls, "describe").length >= 1, true);
});

test("updateVendor: скрытый — можно вернуть isActive:true; модель и группа скрытыми не бывают", async () => {
  const { checked } = await editCheck([{ kind: "updateVendor", params: { id: HIDDEN_VENDOR, isActive: true } }]);
  assert.deepEqual(checked.reasons, []);
  assert.equal(checked.items[0].text, "Изменить вендора «Старый вендор»: активен → «да»");
  const model = await editCheck([{ kind: "updateModel", params: { id: DELETED_MODEL, notes: "x" } }]);
  assert.deepEqual(model.checked.reasons, ["Операция 1: модель Lenovo Deleted скрыта"]);
});

test("updateVendor: id — ссылка на операцию не принимается; пустая правка — отказ", async () => {
  const ref = await editCheck([
    { kind: "createVendor", ref: "v", params: { name: "Acme" } },
    { kind: "updateVendor", params: { id: { ref: "v" }, name: "X" } },
  ]);
  assert.match(ref.checked.reasons.join("\n"), /параметр «id» не принимает ссылку на операцию/);
  const empty = await editCheck([{ kind: "updateVendor", params: { id: VENDOR } }]);
  assert.deepEqual(empty.checked.reasons, ["Операция 1: нет полей для изменения"]);
});

test("updateSupplier: phone, email и address — неизвестные параметры", async () => {
  for (const name of ["phone", "email", "address"]) {
    const { checked } = await editCheck([{ kind: "updateSupplier", params: { id: SUPPLIER, [name]: "x" } }]);
    assert.deepEqual(checked.reasons, [`Операция 1: неизвестный параметр «${name}»`], name);
  }
});

test("updateSupplier: очистка поля и скрытый поставщик", async () => {
  const { checked } = await editCheck(
    [{ kind: "updateSupplier", params: { id: SUPPLIER_HIDDEN, website: null, inn: "7700", isActive: true } }],
    { catalogEditOps: { checkUpdateSupplier: async () => ({ ok: true, before: { isActive: "нет", website: "a.ru", inn: "не задано" } }) } },
  );
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(item.text, "Изменить поставщика «Старый поставщик»: активен → «да», сайт — очистить, ИНН → «7700»");
  assert.deepEqual(item.page.fields, [
    { label: "активен", value: "да", before: "нет" },
    { label: "сайт", value: "очистить", before: "a.ru" },
    { label: "ИНН", value: "7700", before: "не задано" },
  ]);
});

test("updateModel: multiConfig — неизвестный параметр (R6)", async () => {
  const { checked } = await editCheck([{ kind: "updateModel", params: { id: MODEL, multiConfig: true } }]);
  assert.deepEqual(checked.reasons, ["Операция 1: неизвестный параметр «multiConfig»"]);
});

test("updateModel: вендор и совместимые модели — именами в тексте и на странице", async () => {
  const { checked } = await editCheck(
    [{ kind: "updateModel", params: { id: MODEL, vendorId: VENDOR, compatibleWithModelIds: [NEW_MODEL, HIDDEN_MODEL] } }],
    { catalogEditOps: { checkUpdateModel: async () => ({ ok: true, before: { vendorId: "Acer", compatibleWithModelIds: "нет" } }) } },
  );
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(
    item.text,
    "Изменить модель «Lenovo ThinkPad X1»: вендор → «Lenovo», совместимые модели → «Lenovo T14, Lenovo Old»",
  );
  assert.deepEqual(item.page.fields, [
    { label: "вендор", value: "Lenovo", before: "Acer" },
    { label: "совместимые модели", value: "Lenovo T14, Lenovo Old", before: "нет" },
  ]);
  // скрытый вендор — отказ kit
  const hidden = await editCheck([{ kind: "updateModel", params: { id: MODEL, vendorId: HIDDEN_VENDOR } }]);
  assert.deepEqual(hidden.checked.reasons, ["Операция 1: вендор «Старый вендор» скрыт"]);
});

test("updateDeviceType: флаги да/нет, скрытие — свой вид текста, скрытый тип можно вернуть", async () => {
  const flags = await editCheck(
    [{ kind: "updateDeviceType", params: { id: TYPE, isConsumable: true, isComponent: false, inventoryPrefix: "НБ" } }],
    { catalogEditOps: { checkUpdateDeviceType: async () => ({ ok: true, before: { isComponent: "да", isConsumable: "нет", inventoryPrefix: "не задано" } }) } },
  );
  assert.deepEqual(flags.checked.reasons, []);
  assert.equal(
    flags.checked.items[0].text,
    "Изменить тип «Ноутбук»: комплектующее → «нет», расходник → «да», префикс номеров → «НБ»",
  );
  const hide = await editCheck([{ kind: "updateDeviceType", params: { id: TYPE, isActive: false } }], {
    catalogEditOps: { checkUpdateDeviceType: async () => ({ ok: true, before: { isActive: "да" } }) },
  });
  const [item] = hide.checked.items;
  assert.equal(item.text, "Скрыть тип «Ноутбук»");
  assert.equal(item.page.head, "Скрыть тип «Ноутбук»");
  assert.deepEqual(item.page.fields, [{ label: "активен", value: "нет", before: "да" }]);
  const back = await editCheck([{ kind: "updateDeviceType", params: { id: HIDDEN_TYPE, isActive: true } }]);
  assert.deepEqual(back.checked.reasons, []);
  assert.equal(back.checked.items[0].text, "Изменить тип «Старый тип»: активен → «да»");
});

test("updateDeviceType: отказы сервиса — по-русски в причинах операции", async () => {
  const slot = await editCheck([{ kind: "updateDeviceType", params: { id: TYPE, isComponent: false } }], {
    catalogEditOps: {
      checkUpdateDeviceType: async () => ({
        ok: false,
        status: 409,
        message: "Нельзя снять «комплектующее» у типа «Ноутбук»: он стоит в слоте типов «Системный блок»",
      }),
    },
  });
  assert.deepEqual(slot.checked.reasons, [
    "Операция 1: Нельзя снять «комплектующее» у типа «Ноутбук»: он стоит в слоте типов «Системный блок»",
  ]);
  const live = await editCheck([{ kind: "updateDeviceType", params: { id: TYPE, isActive: false } }], {
    catalogEditOps: {
      checkUpdateDeviceType: async () => ({ ok: false, status: 409, message: "Нельзя скрыть тип «Ноутбук»: у него есть модели (3)" }),
    },
  });
  assert.deepEqual(live.checked.reasons, ["Операция 1: Нельзя скрыть тип «Ноутбук»: у него есть модели (3)"]);
});

test("updateGroup: название и порядок; применение зовёт сервис с автором", async () => {
  const { deps, calls } = fakeDeps({
    catalogEditOps: { checkUpdateGroup: async () => ({ ok: true, before: { name: "Процессор", order: "2" } }) },
  });
  const ops = createChangeOps(deps);
  const checked = await ops.checkPackage([{ kind: "updateGroup", params: { id: GROUP, name: "ЦПУ", order: 5 } }], ctx);
  assert.deepEqual(checked.reasons, []);
  assert.equal(checked.items[0].text, "Изменить группу «Процессор»: название → «ЦПУ», порядок → «5»");
  const applied = await ops.applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  const [call] = called(calls, "applyUpdateGroup");
  assert.deepEqual(call.args, [{ id: GROUP, name: "ЦПУ", order: 5 }, { userId: ACTOR }]);
});

test("правка: значения как будут записаны, неизменное поле не показывается", async () => {
  const { checked } = await editCheck(
    [{ kind: "updateDeviceType", params: { id: TYPE, name: "Ноутбук", inventoryPrefix: " нб2 " } }],
    { catalogEditOps: { checkUpdateDeviceType: async () => ({ ok: true, before: { inventoryPrefix: "НБ" } }) } },
  );
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(item.text, "Изменить тип «Ноутбук»: префикс номеров → «НБ2»");
  assert.deepEqual(item.page.fields, [{ label: "префикс номеров", value: "НБ2", before: "НБ" }]);
  const group = await editCheck([{ kind: "updateGroup", params: { id: GROUP, name: "  Ц  П  У " } }]);
  assert.equal(group.checked.items[0].text, "Изменить группу «Процессор»: название → «Ц П У»");
});

// ─── Task 4: атрибут, связь, конфигурация, сборка; снимок refs ─────────────────

const RENAME_REFS = [
  {
    model: "DeviceConfiguration",
    path: "values.value",
    attributeId: ATTR,
    option: "DDR-4",
    ids: ["c00000000000000000000001"],
    live: 7,
    deleted: 0,
    deletedIds: [],
  },
];
const attrChecked = (extra = {}) => ({
  checkUpdateAttribute: async () => ({
    ok: true,
    before: { name: "Тип памяти" },
    added: ["LPDDR5X"],
    renames: [{ from: "DDR-4", to: "DDR4", live: 7, deleted: 0 }],
    refs: RENAME_REFS,
    ...extra,
  }),
});

test("updateAttribute: valueType — неизвестный параметр", async () => {
  const { checked } = await editCheck([{ kind: "updateAttribute", params: { id: ATTR, valueType: "string" } }]);
  assert.deepEqual(checked.reasons, ["Операция 1: неизвестный параметр «valueType»"]);
});

test("updateAttribute: текст и страница — новые варианты и переименование с числом конфигураций; refs в элементе", async () => {
  const params = {
    id: ATTR,
    name: "Тип ОЗУ",
    addOptions: ["LPDDR5X"],
    renameOptions: [{ from: "DDR-4", to: "DDR4" }],
  };
  const { checked } = await editCheck([{ kind: "updateAttribute", params }], { catalogEditOps: attrChecked() });
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(
    item.text,
    "Изменить атрибут «Тип памяти»: название → «Тип ОЗУ», новые варианты: LPDDR5X, вариант «DDR-4» → «DDR4» (в 7 конфигурациях)",
  );
  assert.equal(item.page.head, "Изменить атрибут «Тип памяти»");
  assert.deepEqual(item.page.fields, [
    { label: "название", value: "Тип ОЗУ", before: "Тип памяти" },
    { label: "новые варианты", value: "LPDDR5X" },
    { label: "переименовать вариант", value: "«DDR-4» → «DDR4» · в 7 конфигурациях" },
  ]);
  assert.deepEqual(item.refs, RENAME_REFS);
  assert.deepEqual(item.targets, [{ model: "DeviceAttribute", id: ATTR, updatedAt: T1 }]);
});

test("updateAttribute: удалённые конфигурации — отдельно; одна конфигурация; скрытый можно вернуть, скрытие — свой текст", async () => {
  const one = await editCheck([{ kind: "updateAttribute", params: { id: ATTR, renameOptions: [{ from: "DDR-4", to: "DDR4" }] } }], {
    catalogEditOps: attrChecked({ before: {}, added: [], renames: [{ from: "DDR-4", to: "DDR4", live: 1, deleted: 2 }] }),
  });
  assert.equal(one.checked.items[0].text, "Изменить атрибут «Тип памяти»: вариант «DDR-4» → «DDR4» (в 1 конфигурации и 2 удалённых)");
  const back = await editCheck([{ kind: "updateAttribute", params: { id: HIDDEN_ATTR, isActive: true } }]);
  assert.deepEqual(back.checked.reasons, []);
  assert.equal(back.checked.items[0].text, "Изменить атрибут «Старый атрибут»: активен → «да»");
  const hide = await editCheck([{ kind: "updateAttribute", params: { id: ATTR, isActive: false } }], {
    catalogEditOps: { checkUpdateAttribute: async () => ({ ok: true, before: { isActive: "да" } }) },
  });
  assert.equal(hide.checked.items[0].text, "Скрыть атрибут «Тип памяти»");
});

test("updateAttribute: при применении снимок refs уходит в проверку и запись как ctx.snapshot", async () => {
  const { deps, calls } = fakeDeps({ catalogEditOps: attrChecked() });
  deps.catalogEditOps.checkUpdateAttribute = async (args, options) => {
    calls.push({ name: "checkUpdateAttribute", args: [args, options] });
    return { ok: true, before: {}, added: [], renames: [], refs: RENAME_REFS };
  };
  const ops = createChangeOps(deps);
  const params = { id: ATTR, renameOptions: [{ from: "DDR-4", to: "DDR4" }] };
  const checked = await ops.checkPackage([{ kind: "updateAttribute", params }], ctx);
  assert.deepEqual(checked.reasons, []);
  const applied = await ops.applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  const [atPropose, atApply] = called(calls, "checkUpdateAttribute");
  assert.deepEqual(atPropose.args[1], { allowNoop: false, snapshot: undefined });
  assert.deepEqual(atApply.args[1], { allowNoop: true, snapshot: RENAME_REFS });
  assert.deepEqual(called(calls, "applyUpdateAttribute")[0].args[1], { userId: ACTOR, snapshot: RENAME_REFS });
});

test("refs: предложение → сохранённая операция → элемент исполнителя → ctx применения", async () => {
  const { createProposals } = require("./changeProposals");
  const { createExecutor } = require("./changeExecutor");
  const { deps, calls } = fakeDeps({ catalogEditOps: attrChecked() });
  const ops = createChangeOps(deps);
  const created = [];
  const proposals = createProposals({
    ops,
    now: () => ctx.now,
    store: {
      findUserByTelegram: async () => ({ _id: ACTOR }),
      canFor: async () => true,
      countOpen: async () => 0,
      countByKeySince: async () => 0,
      nextNumber: async () => 1,
      create: async (doc) => (created.push(doc), doc),
    },
  });
  const proposed = await proposals.propose(
    {
      requester: "123",
      title: "Варианты",
      reason: "Дубль варианта",
      operations: [{ kind: "updateAttribute", params: { id: ATTR, renameOptions: [{ from: "DDR-4", to: "DDR4" }] } }],
    },
    { keyId: "k1", keyName: "agent" },
  );
  assert.equal(proposed.ok, true);
  // Как из базы: Mixed возвращается простыми данными
  const stored = JSON.parse(JSON.stringify(created[0]));
  assert.deepEqual(stored.operations[0].refs, RENAME_REFS);
  const executor = createExecutor({ ops, store: { currentUpdatedAt: async () => T1 }, now: () => ctx.now });
  const run = await executor.run(stored, { actorId: ACTOR });
  assert.equal(run.status, "done");
  assert.deepEqual(called(calls, "applyUpdateAttribute")[0].args[1], { userId: ACTOR, snapshot: RENAME_REFS });
});

test("updateTypeAttribute: «Изменить атрибут «A» у типа «T»», группа именем; связи нет — отказ сервиса", async () => {
  const { checked } = await editCheck(
    [{ kind: "updateTypeAttribute", params: { type: TYPE, attribute: ATTR, required: true, groupId: GROUP } }],
    { catalogEditOps: { checkUpdateTypeAttribute: async () => ({ ok: true, before: { required: "нет", groupId: "без группы" } }) } },
  );
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(item.text, "Изменить атрибут «Тип памяти» у типа «Ноутбук»: обязательный → «да», группа → «Процессор»");
  assert.deepEqual(item.page.fields, [
    { label: "обязательный", value: "да", before: "нет" },
    { label: "группа", value: "Процессор", before: "без группы" },
  ]);
  const empty = await editCheck([{ kind: "updateTypeAttribute", params: { type: TYPE, attribute: ATTR } }]);
  assert.deepEqual(empty.checked.reasons, ["Операция 1: нет полей для изменения"]);
  const missing = await editCheck([{ kind: "updateTypeAttribute", params: { type: TYPE, attribute: ATTR, order: 1 } }], {
    catalogEditOps: {
      checkUpdateTypeAttribute: async () => ({ ok: false, status: 404, message: "Атрибут «Тип памяти» не привязан к типу «Ноутбук»" }),
    },
  });
  assert.deepEqual(missing.checked.reasons, ["Операция 1: Атрибут «Тип памяти» не привязан к типу «Ноутбук»"]);
});

test("unlinkAttribute: текст «Снять атрибут «A» с типа «T»»; отказ сервиса; применение по связи", async () => {
  const { deps, calls } = fakeDeps();
  const ops = createChangeOps(deps);
  const checked = await ops.checkPackage([{ kind: "unlinkAttribute", params: { type: TYPE, attribute: ATTR } }], ctx);
  assert.deepEqual(checked.reasons, []);
  assert.equal(checked.items[0].text, "Снять атрибут «Тип памяти» с типа «Ноутбук»");
  assert.equal(checked.items[0].page.head, "Снять атрибут «Тип памяти» с типа «Ноутбук»");
  assert.equal((await ops.applyPackage(checked.items, ctx)).status, "done");
  assert.deepEqual(called(calls, "applyUnlinkAttribute")[0].args, [{ type: TYPE, attribute: ATTR }, { userId: ACTOR }]);
  const refused = await editCheck([{ kind: "unlinkAttribute", params: { type: TYPE, attribute: ATTR } }], {
    catalogEditOps: {
      checkUnlinkAttribute: async () => ({
        ok: false,
        status: 409,
        message: "У конфигураций моделей типа «Ноутбук» есть значения атрибута «Тип памяти» (2): сначала уберите их",
      }),
    },
  });
  assert.match(refused.checked.reasons[0], /сначала уберите их/);
});

test("updateConfiguration: значения строками «атрибут → значение» и «— очистить», было → стало", async () => {
  const { checked } = await editCheck(
    [
      {
        kind: "updateConfiguration",
        params: { id: CONF, setValues: [{ attribute: "ram_gb", value: 32 }], clearValues: ["mem_type"] },
      },
    ],
    {
      catalogEditOps: {
        checkUpdateConfiguration: async () => ({
          ok: true,
          before: {},
          values: [
            { field: "setValues", name: "Объём ОЗУ", value: "32 ГБ", before: "16 ГБ" },
            { field: "clearValues", name: "Тип памяти", value: null, before: "DDR5" },
          ],
        }),
      },
    },
  );
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(item.text, "Изменить конфигурацию «16/512»: Объём ОЗУ → «32 ГБ», Тип памяти — очистить");
  assert.deepEqual(item.page.fields, [
    { label: "Объём ОЗУ", value: "32 ГБ", before: "16 ГБ" },
    { label: "Тип памяти", value: "очистить", before: "DDR5" },
  ]);
  const bad = await editCheck([{ kind: "updateConfiguration", params: { id: CONF, clearValues: [1] } }]);
  assert.deepEqual(bad.checked.reasons, ["Операция 1: параметр «clearValues» — список кодов атрибутов"]);
});

test("updateBuild: детали именами моделей; удалённая сборка — отказ kit", async () => {
  const { checked } = await editCheck(
    [{ kind: "updateBuild", params: { id: BUILD, parts: [{ type: TYPE, model: MODEL, quantity: 2 }] } }],
    { catalogEditOps: { checkUpdateBuild: async () => ({ ok: true, before: { parts: "Lenovo T14" } }) } },
  );
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(item.text, "Изменить шаблон сборки «Офисный»: детали → «Lenovo ThinkPad X1 ×2»");
  assert.deepEqual(item.page.fields, [{ label: "детали", value: "Lenovo ThinkPad X1 ×2", before: "Lenovo T14" }]);
  const deleted = await editCheck([{ kind: "updateBuild", params: { id: DELETED_BUILD, name: "x" } }]);
  assert.deepEqual(deleted.checked.reasons, ["Операция 1: сборка «Удалённый» удалена"]);
});

test("updateTypeAttribute: связь из проверки сервиса — в целях сверки; модель связи зарегистрирована для исполнителя", async () => {
  const LINK_ID = "1000000000000000000000a1";
  const { checked } = await editCheck([{ kind: "updateTypeAttribute", params: { type: TYPE, attribute: ATTR, order: 2 } }], {
    catalogEditOps: {
      checkUpdateTypeAttribute: async () => ({
        ok: true,
        before: { order: "0" },
        targets: [{ model: "DeviceTypeAttribute", id: LINK_ID, updatedAt: T2 }],
      }),
    },
  });
  assert.deepEqual(checked.reasons, []);
  assert.deepEqual(checked.items[0].targets, [
    { model: "DeviceType", id: TYPE, updatedAt: T1 },
    { model: "DeviceAttribute", id: ATTR, updatedAt: T1 },
    { model: "DeviceTypeAttribute", id: LINK_ID, updatedAt: T2 },
  ]);
  // mongoStore исполнителя берёт модель цели по имени
  assert.ok(mongoose.modelNames().includes("DeviceTypeAttribute"));
});

test("updateConfiguration: value в setValues обязателен — снятие только через clearValues", async () => {
  const { checked } = await editCheck([{ kind: "updateConfiguration", params: { id: CONF, setValues: [{ attribute: "ram_gb" }] } }]);
  assert.deepEqual(checked.reasons, ["Операция 1: не указан параметр «setValues[0].value»"]);
  const empty = await editCheck([{ kind: "updateConfiguration", params: { id: CONF, setValues: [{ attribute: "ram_gb", value: null }] } }]);
  assert.deepEqual(empty.checked.reasons, ["Операция 1: не указан параметр «setValues[0].value»"]);
});

test("скрытый атрибут или тип: связь можно править и снять", async () => {
  const unlink = await editCheck([{ kind: "unlinkAttribute", params: { type: HIDDEN_TYPE, attribute: HIDDEN_ATTR } }]);
  assert.deepEqual(unlink.checked.reasons, []);
  assert.equal(unlink.checked.items[0].text, "Снять атрибут «Старый атрибут» с типа «Старый тип»");
  const update = await editCheck(
    [{ kind: "updateTypeAttribute", params: { type: HIDDEN_TYPE, attribute: HIDDEN_ATTR, required: false } }],
    { catalogEditOps: { checkUpdateTypeAttribute: async () => ({ ok: true, before: { required: "да" } }) } },
  );
  assert.deepEqual(update.checked.reasons, []);
});

// ─── Слияния ────────────────────────────────────────────────────────────────

const mergeCheck = async (operations, overrides) => {
  const { deps, calls } = fakeDeps(overrides);
  const ops = createChangeOps(deps);
  return { ops, calls, checked: await ops.checkPackage(operations, ctx) };
};
const SEPARATE = "слияние или скрытие предложите отдельным пакетом после утверждения этого";

test("права: mergeModels требует и справочники, и устройства", () => {
  const { KINDS, requiredRights } = createChangeOps(fakeDeps().deps);
  const catalogRight = { inventoryCatalog: ["manage"] };
  const deviceRight = { device: ["manage"] };
  assert.deepEqual(KINDS.mergeModels.right, [catalogRight, deviceRight]);
  assert.deepEqual(KINDS.mergeSuppliers.right, [{ supplier: ["manage"] }, deviceRight]);
  assert.deepEqual(KINDS.mergeVendors.right, catalogRight);
  assert.deepEqual(KINDS.mergeGroups.right, catalogRight);
  assert.deepEqual(KINDS.mergeAttributes.right, catalogRight);
  assert.deepEqual(KINDS.mergeConfigurations.right, [catalogRight, deviceRight]);
  assert.deepEqual(KINDS.mergeDeviceTypes.right, [catalogRight, deviceRight]);
  assert.deepEqual(requiredRights([{ kind: "mergeModels", params: {} }]), [catalogRight, deviceRight]);
  assert.deepEqual(
    requiredRights([
      { kind: "mergeVendors", params: {} },
      { kind: "mergeSuppliers", params: {} },
    ]),
    [catalogRight, { supplier: ["manage"] }, deviceRight],
  );
  for (const kind of ["mergeVendors", "mergeSuppliers", "mergeGroups", "mergeModels", "mergeAttributes", "mergeConfigurations", "mergeDeviceTypes"]) {
    assert.deepEqual(KINDS[kind].refKinds, [], kind);
  }
});

test("пакет: source как {ref} — отказ", async () => {
  const { checked, calls } = await mergeCheck([
    { kind: "createVendor", ref: "v", params: { name: "Lenovo" } },
    { kind: "mergeVendors", params: { source: { ref: "v" }, target: VENDOR } },
    { kind: "mergeVendors", params: { source: VENDOR2, target: { ref: "v" } } },
  ]);
  assert.deepEqual(checked.reasons, [
    "Операция 2: параметр «source» не принимает ссылку на операцию",
    "Операция 3: параметр «target» не принимает ссылку на операцию",
  ]);
  assert.equal(called(calls, "planMerge").length, 0);
});

test("пакет: правка конфигурации → слияние атрибута в одном пакете — отказ «отдельным пакетом»", async () => {
  // Конфигурация CONF — в снимке значений слияния атрибута и уже меняется раньше в пакете
  const attribute = await mergeCheck([
    { kind: "updateConfiguration", params: { id: CONF, setValues: [{ attribute: "ram_gb", value: "32" }] } },
    { kind: "mergeAttributes", params: { source: ATTR, target: ATTR2 } },
  ]);
  assert.deepEqual(attribute.checked.reasons, [`Операция 2: ${SEPARATE}`]);
  // Конфигурация вне снимка, но значение — по коду атрибута-источника: тоже отказ
  // (setValues и values называют атрибут кодом, не id)
  const byCode = (code) =>
    mergeCheck(
      [
        { kind: "updateConfiguration", params: { id: CONF, setValues: [{ attribute: code, value: "32" }] } },
        { kind: "mergeAttributes", params: { source: ATTR, target: ATTR2 } },
      ],
      {
        catalogMerge: {
          plan: async (e, s, t) => mergePlan(e, s, t, { refs: { ...mergeSnap(e, s, t, { ClientDevice: [PART1] }), codes: ["ram_old", "ram_gb"] } }),
        },
      },
    );
  assert.deepEqual((await byCode("RAM_OLD")).checked.reasons, [`Операция 2: ${SEPARATE}`]);
  assert.deepEqual((await byCode("ram_gb")).checked.reasons, [`Операция 2: ${SEPARATE}`]);
  assert.deepEqual((await byCode("cpu")).checked.reasons, []);
  // То же правило у слияния модели
  const viaSnapshot = await mergeCheck([
    { kind: "updateConfiguration", params: { id: CONF, name: "32/1T" } },
    { kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } },
  ]);
  assert.deepEqual(viaSnapshot.checked.reasons, [`Операция 2: ${SEPARATE}`]);
  // Более ранняя операция называет источник или цель в параметрах
  const viaParams = await mergeCheck([
    { kind: "updateModel", params: { id: NEW_MODEL, name: "T14 Gen 4" } },
    { kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } },
  ]);
  assert.deepEqual(viaParams.checked.reasons, [`Операция 2: ${SEPARATE}`]);
  // Другое слияние раньше: его снимок пересекается со снимком этого
  const twoMerges = await mergeCheck([
    { kind: "mergeVendors", params: { source: VENDOR2, target: VENDOR3 } },
    { kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } },
  ]);
  // Правило в обе стороны: отказ у обоих слияний
  assert.deepEqual(twoMerges.checked.reasons, [`Операция 1: ${SEPARATE}`, `Операция 2: ${SEPARATE}`]);
  // Не пересекается — можно
  const apart = await mergeCheck(
    [
      { kind: "updateVendor", params: { id: VENDOR, name: "Lenovo Group" } },
      { kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } },
    ],
    { catalogMerge: { plan: async (e, s, t) => mergePlan(e, s, t, { refs: mergeSnap(e, s, t, { ClientDevice: [PART1] }) }) } },
  );
  assert.deepEqual(apart.checked.reasons, []);
});

test("mergeModels: текст и страница — числа, устройства ссылками, «Несколько конфигураций», судьба источника", async () => {
  const devices = [
    { id: HOST, label: "ПК PC-000123" },
    { id: PART1, label: "ОЗУ RAM-000045" },
    { id: PART2, label: "SSD SSD-000012" },
    { id: "aaaaaaaaaaaaaaaaaaaaaaa7", label: "ПК PC-000124" },
    { id: "aaaaaaaaaaaaaaaaaaaaaaa8", label: "ПК PC-000125" },
  ];
  const seen = [];
  const plan = async (entity, source, target) =>
    seen.push([entity, source, target]) &&
    mergePlan(entity, source, target, {
      lines: ["устройств: 12 и 1 удалённое", "конфигураций: 3", "сборок: 1", "совместимость: у 2 моделей"],
      devices,
      deviceLabels: devices.map((d) => d.label),
      moreDevices: 7,
      multiOn: true,
      newName: "ThinkPad X1 (слито в «T14»)",
    });
  const { checked } = await mergeCheck([{ kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } }], {
    catalogMerge: { plan },
  });
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.equal(
    item.text,
    [
      "Слить модель «Lenovo ThinkPad X1» в «Lenovo T14»",
      "устройств: 12 и 1 удалённое",
      "конфигураций: 3",
      "сборок: 1",
      "совместимость: у 2 моделей",
      "у «Lenovo T14» включится «Несколько конфигураций»",
      "«Lenovo ThinkPad X1» скроется",
    ].join("\n"),
  );
  assert.equal(item.page.head, "Слить модель «Lenovo ThinkPad X1» в «Lenovo T14»");
  assert.deepEqual(item.page.fields, [
    { label: "устройств", value: "12 и 1 удалённое" },
    { label: "конфигураций", value: "3" },
    { label: "сборок", value: "1" },
    { label: "совместимость", value: "у 2 моделей" },
  ]);
  assert.deepEqual(item.page.subs, [
    "Устройства: ПК PC-000123, ОЗУ RAM-000045, SSD SSD-000012, ПК PC-000124, ПК PC-000125 … и ещё 7",
    "у «Lenovo T14» включится «Несколько конфигураций»",
    "Модель «Lenovo ThinkPad X1» скроется и получит имя «ThinkPad X1 (слито в «T14»)»",
  ]);
  // Ссылки: обе модели и пять устройств; подписи — ровно как в подстроке
  assert.deepEqual(item.page.links, [
    { model: "DeviceModel", id: MODEL, label: "Lenovo ThinkPad X1" },
    { model: "DeviceModel", id: NEW_MODEL, label: "Lenovo T14" },
    ...devices.map((d) => ({ model: "ClientDevice", id: d.id, label: d.label })),
  ]);
  for (const link of item.page.links.slice(2)) assert.ok(item.page.subs[0].includes(link.label));
  assert.deepEqual(item.targets, [
    { model: "DeviceModel", id: MODEL, updatedAt: T2 },
    { model: "DeviceModel", id: NEW_MODEL, updatedAt: T3 },
  ]);
  assert.deepEqual(item.refs, mergeSnap("DeviceModel", MODEL, NEW_MODEL));
  assert.deepEqual(seen, [["DeviceModel", MODEL, NEW_MODEL]]);
});

test("mergeGroups и mergeVendors: судьба источника — «удалится» и «скроется»; отказ плана — по-русски", async () => {
  const group = await mergeCheck([{ kind: "mergeGroups", params: { source: GROUP, target: GROUP2 } }], {
    catalogMerge: { plan: async (e, s, t) => mergePlan(e, s, t, { lines: ["связей: 2"], devices: [], deviceLabels: [] }) },
  });
  assert.deepEqual(group.checked.reasons, []);
  assert.equal(group.checked.items[0].text, "Слить группу «Процессор» в «ЦП»\nсвязей: 2\nгруппа «Процессор» удалится");
  assert.deepEqual(group.checked.items[0].page.subs, ["Группа «Процессор» удалится"]);
  const vendor = await mergeCheck([{ kind: "mergeVendors", params: { source: VENDOR2, target: VENDOR3 } }], {
    catalogMerge: { plan: async (e, s, t) => mergePlan(e, s, t, { lines: ["моделей: 4"], devices: [], newName: "Lenovo Inc (слито в «Lenovo Group»)" }) },
  });
  assert.equal(vendor.checked.items[0].text, "Слить вендора «Lenovo Inc» в «Lenovo Group»\nмоделей: 4\n«Lenovo Inc» скроется");
  assert.deepEqual(vendor.checked.items[0].page.subs, ["Вендор «Lenovo Inc» скроется и получит имя «Lenovo Inc (слито в «Lenovo Group»)»"]);
  // Скрытая цель — отказ kit; та же запись и прочее — текст плана
  const hidden = await mergeCheck([{ kind: "mergeVendors", params: { source: VENDOR, target: HIDDEN_VENDOR } }]);
  assert.deepEqual(hidden.checked.reasons, ["Операция 1: вендор «Старый вендор» скрыт"]);
  const self = await mergeCheck([{ kind: "mergeVendors", params: { source: VENDOR, target: VENDOR } }], {
    catalogMerge: { plan: async () => ({ ok: false, status: 400, error: "Нельзя слить запись саму в себя" }) },
  });
  assert.deepEqual(self.checked.reasons, ["Операция 1: Нельзя слить запись саму в себя"]);
});

test("mergeVendors: при применении снимок уходит в catalogMerge.apply; без снимка — отказ", async () => {
  const { ops, calls, checked } = await mergeCheck([{ kind: "mergeVendors", params: { source: VENDOR2, target: VENDOR3 } }]);
  const applied = await ops.applyPackage(checked.items, ctx);
  assert.equal(applied.status, "done");
  const [call] = called(calls, "applyMerge");
  assert.deepEqual(call.args, ["Vendor", mergeSnap("Vendor", VENDOR2, VENDOR3), { userId: ACTOR }]);
  const bare = await ops.applyPackage([{ ...checked.items[0], refs: undefined }], ctx);
  assert.equal(bare.status, "failed");
  assert.match(bare.results[0].error, /нет снимка/);
  // Отказ при применении (дрейф) — текстом catalogMerge
  const { deps } = fakeDeps({
    catalogMerge: { apply: async () => ({ ok: false, status: 409, error: "изменилось после предложения: на вендора «Lenovo Inc» появилась 1 новая модель" }) },
  });
  const failed = await createChangeOps(deps).applyPackage(checked.items, ctx);
  assert.deepEqual(failed.results, [
    { state: "failed", error: "изменилось после предложения: на вендора «Lenovo Inc» появилась 1 новая модель" },
  ]);
});

test("пакет: правка вендора + слияние с дрейфом — ничего не применено", async () => {
  const { createExecutor, DRIFT_ELSEWHERE } = require("./changeExecutor");
  const drift = "изменилось после предложения: на вендора «Lenovo Inc» появилась 1 новая модель";
  const { deps, calls } = fakeDeps({ catalogMerge: { drift: async (...args) => (calls.push({ name: "mergeDrift", args }), drift) } });
  const ops = createChangeOps(deps);
  const checked = await ops.checkPackage(
    [
      { kind: "updateVendor", params: { id: VENDOR, name: "Lenovo Group" } },
      { kind: "mergeVendors", params: { source: VENDOR2, target: VENDOR3 } },
    ],
    ctx,
  );
  assert.deepEqual(checked.reasons, []);
  const change = JSON.parse(JSON.stringify({ operations: checked.items }));
  const executor = createExecutor({ ops, store: { currentUpdatedAt: async () => T1 }, now: () => ctx.now });
  const run = await executor.run(change, { actorId: ACTOR });
  assert.equal(run.status, "failed");
  assert.deepEqual(run.results, [
    { state: "skipped", error: DRIFT_ELSEWHERE },
    { state: "skipped", error: drift },
  ]);
  assert.deepEqual(run.drift, [drift]);
  assert.deepEqual(called(calls, "mergeDrift")[0].args, ["Vendor", mergeSnap("Vendor", VENDOR2, VENDOR3)]);
  assert.equal(called(calls, "applyUpdateVendor").length, 0);
  assert.equal(called(calls, "applyMerge").length, 0);
});

test("updateAttribute: снимок сверяется до записи — дрейф из проверки сервиса, прочие отказы — не дрейф", async () => {
  const drift = "изменилось после предложения: вариант «DDR-4» появился ещё в 1 конфигурации";
  const { deps, calls } = fakeDeps();
  let answer = { ok: false, status: 409, message: drift };
  deps.catalogEditOps.checkUpdateAttribute = async (args, options) => {
    calls.push({ name: "checkUpdateAttribute", args: [args, options] });
    return options.snapshot === undefined ? { ok: true, before: {}, renames: [], refs: RENAME_REFS } : answer;
  };
  const ops = createChangeOps(deps);
  const params = { id: ATTR, renameOptions: [{ from: "DDR-4", to: "DDR4" }] };
  const [item] = (await ops.checkPackage([{ kind: "updateAttribute", params }], ctx)).items;
  assert.equal(await ops.snapshotDrift(item), drift);
  assert.deepEqual(called(calls, "checkUpdateAttribute").at(-1).args[1], { allowNoop: true, snapshot: RENAME_REFS });
  answer = { ok: false, status: 409, message: "Вариант «DDR4» уже есть у атрибута «Тип памяти»" };
  assert.equal(await ops.snapshotDrift(item), null);
  // Вид без снимка — сверять нечего
  assert.equal(await ops.snapshotDrift({ kind: "updateVendor", params: { id: VENDOR, name: "X" } }), null);
});

test("пакет: слияние → более поздняя операция над его данными — отказ «отдельным пакетом»", async () => {
  // Позже правится цель
  const target = await mergeCheck([
    { kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } },
    { kind: "updateModel", params: { id: NEW_MODEL, name: "T14 Gen 4" } },
  ]);
  assert.deepEqual(target.checked.reasons, [`Операция 1: ${SEPARATE}`]);
  // Позже правится конфигурация из снимка слияния
  const config = await mergeCheck([
    { kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } },
    { kind: "updateConfiguration", params: { id: CONF, name: "32/1T" } },
  ]);
  assert.deepEqual(config.checked.reasons, [`Операция 1: ${SEPARATE}`]);
  // Позже — устройство из снимка (перенос)
  const device = await mergeCheck([
    { kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } },
    { kind: "moveDevice", params: { device: HOST, location: LOC } },
  ]);
  assert.deepEqual(device.checked.reasons, [`Операция 1: ${SEPARATE}`]);
  // Позже — не пересекается: можно
  const apart = await mergeCheck([
    { kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } },
    { kind: "updateVendor", params: { id: VENDOR, name: "Lenovo Group" } },
  ]);
  assert.deepEqual(apart.checked.reasons, []);
});

test("слияние: итог операции несёт moved; в схеме результата есть поле", async () => {
  const { ops, checked } = await mergeCheck([{ kind: "mergeVendors", params: { source: VENDOR2, target: VENDOR3 } }]);
  const seen = [];
  const applied = await ops.applyPackage(checked.items, { ...ctx, onResult: async (i, r) => seen.push([i, r]) });
  assert.deepEqual(applied.results, [{ state: "done", moved: { устройств: 2 } }]);
  assert.deepEqual(seen, [[0, { state: "done", moved: { устройств: 2 } }]]);
  // Правки без moved — без поля
  const edit = await mergeCheck([{ kind: "updateVendor", params: { id: VENDOR, name: "Lenovo Group" } }]);
  assert.deepEqual((await edit.ops.applyPackage(edit.checked.items, ctx)).results, [{ state: "done" }]);
  const InventoryChange = require("../../models/inventory/inventoryChange");
  const op = InventoryChange.schema.path("operations").schema;
  assert.equal(op.path("result.moved").instance, "Mixed");
});

test("mergeModels: одинаковые конфигурации — подстрока «сольётся», без «Несколько конфигураций»", async () => {
  const plan = async (e, s, t) => mergePlan(e, s, t, { devices: [], collapse: { from: "16/512", into: "Lenovo T14" } });
  const { checked } = await mergeCheck([{ kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL } }], {
    catalogMerge: { plan },
  });
  const [item] = checked.items;
  assert.equal(
    item.text,
    "Слить модель «Lenovo ThinkPad X1» в «Lenovo T14»\nустройств: 1\nконфигураций: 1\nконфигурация «16/512» сольётся с «Lenovo T14»\n«Lenovo ThinkPad X1» скроется",
  );
  assert.deepEqual(item.page.subs, [
    "конфигурация «16/512» сольётся с «Lenovo T14»",
    "Модель «Lenovo ThinkPad X1» скроется и получит имя «Старое (слито в «Новое»)»",
  ]);
});

test("слияние: отказ при применении несёт moved — перенесённое до сбоя", async () => {
  const error = "ссылки перенесены, но «Lenovo Inc» не скрыт: имя «Lenovo Inc (слито в «Lenovo Group»)» уже занято";
  const { deps } = fakeDeps({ catalogMerge: { apply: async () => ({ ok: false, status: 409, error, moved: { моделей: 4 } }) } });
  const ops = createChangeOps(deps);
  const checked = await ops.checkPackage([{ kind: "mergeVendors", params: { source: VENDOR2, target: VENDOR3 } }], ctx);
  const applied = await ops.applyPackage(checked.items, ctx);
  assert.equal(applied.status, "failed");
  assert.deepEqual(applied.results, [{ state: "failed", error, moved: { моделей: 4 } }]);
});

test("mergeAttributes: optionMap уходит в план; карта и варианты — подстроками текста и страницы", async () => {
  const seen = [];
  const plan = async (entity, source, target, options) => {
    seen.push([entity, source, target, options.optionMap]);
    return mergePlan(entity, source, target, {
      lines: ["связей: 1", "значений: 3"],
      devices: [],
      deviceLabels: [],
      notes: ["варианты: «DDR-4» → «DDR4»", "к «Тип ОЗУ» добавятся варианты: «LPDDR5»"],
      newName: "Тип памяти (слито в «Тип ОЗУ»)",
    });
  };
  const optionMap = { "DDR-4": "DDR4" };
  const { checked } = await mergeCheck([{ kind: "mergeAttributes", params: { source: ATTR, target: ATTR2, optionMap } }], {
    catalogMerge: { plan },
  });
  assert.deepEqual(checked.reasons, []);
  assert.deepEqual(seen, [["DeviceAttribute", ATTR, ATTR2, optionMap]]);
  const [item] = checked.items;
  assert.equal(
    item.text,
    [
      "Слить атрибут «Тип памяти» в «Тип ОЗУ»",
      "связей: 1",
      "значений: 3",
      "варианты: «DDR-4» → «DDR4»",
      "к «Тип ОЗУ» добавятся варианты: «LPDDR5»",
      "«Тип памяти» скроется",
    ].join("\n"),
  );
  assert.deepEqual(item.page.subs, [
    "варианты: «DDR-4» → «DDR4»",
    "к «Тип ОЗУ» добавятся варианты: «LPDDR5»",
    "Атрибут «Тип памяти» скроется и получит имя «Тип памяти (слито в «Тип ОЗУ»)»",
  ]);
  // Форма карты: объект строк; у других слияний карты нет
  const bad = await mergeCheck([
    { kind: "mergeAttributes", params: { source: ATTR, target: ATTR2, optionMap: ["DDR4"] } },
    { kind: "mergeAttributes", params: { source: ATTR, target: ATTR2, optionMap: { "DDR-4": 4 } } },
    { kind: "mergeModels", params: { source: MODEL, target: NEW_MODEL, optionMap } },
  ]);
  assert.deepEqual(bad.checked.reasons, [
    "Операция 1: параметр «optionMap» — объект «вариант источника → вариант цели»",
    "Операция 2: параметр «optionMap» — объект «вариант источника → вариант цели»",
    "Операция 3: неизвестный параметр «optionMap»",
  ]);
});

test("mergeConfigurations и mergeDeviceTypes: заголовок и судьба источника", async () => {
  const config = await mergeCheck([{ kind: "mergeConfigurations", params: { source: CONF, target: CONF } }], {
    catalogMerge: { plan: async (e, s, t) => mergePlan(e, s, t, { lines: ["устройств: 1"], newName: "16/512 (слито в «16/512»)" }) },
  });
  assert.equal(config.checked.items[0].text, "Слить конфигурацию «16/512» в «16/512»\nустройств: 1\n«16/512» скроется");
  const type = await mergeCheck([{ kind: "mergeDeviceTypes", params: { source: NEW_TYPE, target: TYPE } }], {
    catalogMerge: { plan: async (e, s, t) => mergePlan(e, s, t, { lines: ["моделей: 2"], devices: [], newName: "Моноблок (слито в «Ноутбук»)" }) },
  });
  assert.equal(type.checked.items[0].text, "Слить тип «Моноблок» в «Ноутбук»\nмоделей: 2\n«Моноблок» скроется");
  assert.deepEqual(type.checked.items[0].page.subs, ["Тип «Моноблок» скроется и получит имя «Моноблок (слито в «Ноутбук»)»"]);
});

// ─── Скрытие неиспользуемого ────────────────────────────────────────────────

const retirePlan = (entity, id) => ({
  ok: true,
  refs: { entity, source: id, refs: [{ model: "ClientDevice", path: "deviceModelId", ids: [PART1], live: 0, deleted: 1, deletedIds: [PART1] }] },
  lines: ["устройств: 1"],
  sourceName: "Старое",
});

test("права: retire* — справочники, retireSupplier — поставщики; id только существующий", async () => {
  const { KINDS } = createChangeOps(fakeDeps().deps);
  for (const kind of ["retireVendor", "retireModel", "retireAttribute", "retireDeviceType", "deleteGroup"]) {
    assert.deepEqual(KINDS[kind].right, { inventoryCatalog: ["manage"] }, kind);
    assert.deepEqual(KINDS[kind].refKinds, [], kind);
  }
  assert.deepEqual(KINDS.retireSupplier.right, { supplier: ["manage"] });
  const { checked, calls } = await mergeCheck([
    { kind: "createVendor", ref: "v", params: { name: "Lenovo" } },
    { kind: "retireVendor", params: { id: { ref: "v" } } },
  ]);
  assert.deepEqual(checked.reasons, ["Операция 2: параметр «id» не принимает ссылку на операцию"]);
  assert.equal(called(calls, "planRetire").length, 0);
});

test("retireModel: текст «Скрыть … (не используется)», снимок и сверка дрейфа", async () => {
  const seen = [];
  const { ops, checked } = await mergeCheck([{ kind: "retireModel", params: { id: MODEL } }], {
    catalogMerge: {
      planRetire: async (entity, id) => retirePlan(entity, id),
      driftRetire: async (entity, snapshot) => seen.push([entity, snapshot.source]) && "изменилось после предложения: на модель «X» появилось 1 новое устройство",
    },
  });
  assert.deepEqual(checked.reasons, []);
  const [item] = checked.items;
  assert.match(item.text, /^Скрыть модель «.+» \(не используется\)\nСсылаются только удалённые — устройств: 1$/);
  assert.equal(item.refs.source, MODEL);
  assert.match(await ops.snapshotDrift(item), /появилось 1 новое устройство/);
  assert.deepEqual(seen, [["DeviceModel", MODEL]]);
});

test("deleteGroup: «Удалить пустую группу «A»»; отказ плана доходит до причин", async () => {
  const ok = await mergeCheck([{ kind: "deleteGroup", params: { id: GROUP2 } }], {
    catalogMerge: { planRetire: async (entity, id) => ({ ...retirePlan(entity, id), lines: [] }) },
  });
  assert.equal(ok.checked.items[0].text, "Удалить пустую группу «ЦП»");
  const busy = await mergeCheck([{ kind: "deleteGroup", params: { id: GROUP2 } }], {
    catalogMerge: { planRetire: async () => ({ ok: false, status: 409, error: "Удалить нельзя: в группе «ЦП» есть связи (связей: 2)" }) },
  });
  assert.match(busy.checked.reasons[0], /связей: 2/);
});

test("пакет: retire* вместе с правкой той же записи — отказ «отдельным пакетом»", async () => {
  const { checked } = await mergeCheck(
    [
      { kind: "updateModel", params: { id: MODEL, name: "Другое" } },
      { kind: "retireModel", params: { id: MODEL } },
    ],
    { catalogMerge: { planRetire: async (entity, id) => retirePlan(entity, id) } },
  );
  assert.deepEqual(checked.reasons, [`Операция 2: ${SEPARATE}`]);
});

// ─── Финальная правка фазы 4 ──────────────────────────────────────────────────

test("пакет: каталог + слияние типов — отказ «отдельным пакетом»", async () => {
  const catalog = { kind: "catalog", params: { types: [{ key: "mono", name: "Моноблок" }] } };
  // Каталог подхватывает по имени и коду: слияние или скрытие типа, атрибута, группы — отдельно
  for (const op of [
    { kind: "mergeDeviceTypes", params: { source: TYPE, target: SYS_TYPE } },
    { kind: "mergeAttributes", params: { source: ATTR, target: ATTR2 } },
    { kind: "mergeGroups", params: { source: GROUP, target: GROUP2 } },
    { kind: "retireDeviceType", params: { id: TYPE } },
    { kind: "retireAttribute", params: { id: ATTR } },
    { kind: "deleteGroup", params: { id: GROUP2 } },
  ]) {
    const before = await mergeCheck([catalog, op], {
      catalogMerge: { planRetire: async (entity, id) => retirePlan(entity, id) },
    });
    assert.deepEqual(before.checked.reasons, [`Операция 2: ${SEPARATE}`], op.kind);
    // Каталог позже — тоже
    const after = await mergeCheck([op, catalog], {
      catalogMerge: { planRetire: async (entity, id) => retirePlan(entity, id) },
    });
    assert.deepEqual(after.checked.reasons, [`Операция 1: ${SEPARATE}`], op.kind);
  }
  // Слияние вендоров каталог не задевает
  const vendors = await mergeCheck([catalog, { kind: "mergeVendors", params: { source: VENDOR2, target: VENDOR3 } }], {
    catalogMerge: { plan: async (e, s, t) => mergePlan(e, s, t, { refs: mergeSnap(e, s, t, { DeviceModel: [NEW_MODEL] }) }) },
  });
  assert.deepEqual(vendors.checked.reasons, []);
});

test("пакет: retireAttribute + setValues по коду — отказ", async () => {
  // Снимок скрытия атрибута несёт его код (catalogMerge.planRetire)
  const planRetire = async (entity, id) => {
    const plan = retirePlan(entity, id);
    return { ...plan, refs: { ...plan.refs, codes: ["mem_type"] } };
  };
  const ops = (code) => [
    { kind: "updateConfiguration", params: { id: CONF, setValues: [{ attribute: code, value: "DDR5" }] } },
    { kind: "retireAttribute", params: { id: ATTR } },
  ];
  assert.deepEqual((await mergeCheck(ops("MEM_TYPE"), { catalogMerge: { planRetire } })).checked.reasons, [`Операция 2: ${SEPARATE}`]);
  assert.deepEqual((await mergeCheck(ops("ram_gb"), { catalogMerge: { planRetire } })).checked.reasons, []);
});

test("правка: скрытие через isActive — «Скрыть атрибут «X»» без «(не используется)»", async () => {
  const cases = [
    ["updateAttribute", ATTR, "checkUpdateAttribute", "Скрыть атрибут «Тип памяти»"],
    ["updateDeviceType", TYPE, "checkUpdateDeviceType", "Скрыть тип «Ноутбук»"],
    ["updateVendor", VENDOR, "checkUpdateVendor", "Скрыть вендора «Lenovo»"],
    ["updateSupplier", SUPPLIER, "checkUpdateSupplier", "Скрыть поставщика «Ситилинк»"],
  ];
  for (const [kind, id, svc, head] of cases) {
    const { checked } = await editCheck([{ kind, params: { id, isActive: false } }], {
      catalogEditOps: { [svc]: async () => ({ ok: true, before: { isActive: "да" } }) },
    });
    assert.deepEqual(checked.reasons, [], kind);
    assert.equal(checked.items[0].text, head, kind);
    assert.equal(checked.items[0].page.head, head, kind);
  }
  // Скрытие вместе с другим полем — обычная правка
  const both = await editCheck([{ kind: "updateVendor", params: { id: VENDOR, name: "Lenovo Group", isActive: false } }], {
    catalogEditOps: { checkUpdateVendor: async () => ({ ok: true, before: { name: "Lenovo", isActive: "да" } }) },
  });
  assert.equal(both.checked.items[0].text, "Изменить вендора «Lenovo»: название → «Lenovo Group», активен → «нет»");
});

test("пакет: переименование вариантов + значение или связь того же атрибута — отказ «отдельным пакетом»", async () => {
  // Снимок переименования несёт код атрибута (catalogEditOps optionRefs)
  const withCode = attrChecked({ refs: RENAME_REFS.map((r) => ({ ...r, code: "mem_type" })) });
  const rename = { kind: "updateAttribute", params: { id: ATTR, renameOptions: [{ from: "DDR-4", to: "DDR4" }] } };
  const value = (code) => ({ kind: "updateConfiguration", params: { id: CONF, setValues: [{ attribute: code, value: "DDR4" }] } });
  const link = { kind: "updateTypeAttribute", params: { type: TYPE, attribute: ATTR, required: true } };
  const check = (operations) => mergeCheck(operations, { catalogEditOps: withCode });
  assert.deepEqual((await check([rename, value("mem_type")])).checked.reasons, [`Операция 1: ${SEPARATE}`]);
  assert.deepEqual((await check([value("MEM_TYPE"), rename])).checked.reasons, [`Операция 2: ${SEPARATE}`]);
  assert.deepEqual((await check([rename, link])).checked.reasons, [`Операция 1: ${SEPARATE}`]);
  // Другой атрибут — можно; без переименования правка атрибута правилу не подлежит
  assert.deepEqual((await check([rename, value("ram_gb")])).checked.reasons, []);
  const plain = { kind: "updateAttribute", params: { id: ATTR, name: "Тип ОЗУ" } };
  assert.deepEqual((await check([plain, value("mem_type")])).checked.reasons, []);
});

test("скрытие: только удалённые ссылки — строка без двойного двоеточия", async () => {
  const { checked } = await mergeCheck([{ kind: "retireModel", params: { id: MODEL } }], {
    catalogMerge: { planRetire: async (entity, id) => retirePlan(entity, id) },
  });
  const [item] = checked.items;
  assert.equal(item.text.split("\n")[1], "Ссылаются только удалённые — устройств: 1");
  assert.deepEqual(item.page.subs, ["Ссылаются только удалённые — устройств: 1"]);
});
