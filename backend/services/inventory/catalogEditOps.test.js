// node --test services/inventory/catalogEditOps.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCatalogEditOps } = require("./catalogEditOps");
const { parseGroupName } = require("@/controllers/inventory/attributeGroup");

const VENDOR = "fffffffffffffffffffffff1";
const VENDOR2 = "fffffffffffffffffffffff2";
const HIDDEN_VENDOR = "fffffffffffffffffffffff3";
const SUPPLIER = "555555555555555555555551";
const MODEL = "bbbbbbbbbbbbbbbbbbbbbbb1";
const MODEL2 = "bbbbbbbbbbbbbbbbbbbbbbb2";
const MODEL3 = "bbbbbbbbbbbbbbbbbbbbbbb3";
const DELETED_MODEL = "bbbbbbbbbbbbbbbbbbbbbbb9";
const TYPE = "eeeeeeeeeeeeeeeeeeeeeee1";
const TYPE2 = "eeeeeeeeeeeeeeeeeeeeeee2";
const GROUP = "dddddddddddddddddddddd01";
const USER = "333333333333333333333333";

// Подделка store: документы по kind -> id; записи копятся в writes
const fakeStore = (extra = {}) => {
  const docs = {
    vendor: {
      [VENDOR]: { _id: VENDOR, name: "HP", isActive: true },
      [VENDOR2]: { _id: VENDOR2, name: "Lenovo", isActive: true },
      [HIDDEN_VENDOR]: { _id: HIDDEN_VENDOR, name: "Старый", isActive: false },
    },
    supplier: { [SUPPLIER]: { _id: SUPPLIER, name: "Ситилинк", isActive: true, website: "citilink.ru", inn: "7700000000" } },
    model: {
      [MODEL]: { _id: MODEL, name: "ProBook", vendorId: VENDOR, notes: "старая", compatibleWithModelIds: [MODEL2], deletedAt: null },
      [MODEL2]: { _id: MODEL2, name: "EliteBook", vendorId: VENDOR, deletedAt: null },
      [MODEL3]: { _id: MODEL3, name: "ThinkPad", vendorId: VENDOR2, deletedAt: null },
      [DELETED_MODEL]: { _id: DELETED_MODEL, name: "Old", vendorId: VENDOR, deletedAt: new Date() },
    },
    type: {
      [TYPE]: { _id: TYPE, name: "Ноутбук", isActive: true, isComponent: true, inventoryPrefix: "НБ", attachableToTypeIds: [TYPE2] },
      [TYPE2]: { _id: TYPE2, name: "Док-станция", isActive: true },
    },
    group: { [GROUP]: { _id: GROUP, name: "Процессор", order: 2 } },
  };
  const state = { docs, writes: [], liveModels: 0, owners: [], holders: {}, ...extra };
  const title = (kind, doc) =>
    kind === "model" ? [docs.vendor[String(doc.vendorId)]?.name, doc.name].filter(Boolean).join(" ") : doc.name;
  state.store = {
    get: async (kind, id) => docs[kind][String(id)] ?? null,
    nameHolder: async (kind, name) => state.holders[kind]?.[name] ?? null,
    find: async (kind, ids) =>
      ids.filter((id) => docs[kind][id] && !docs[kind][id].deletedAt).map((id) => ({ _id: id, name: title(kind, docs[kind][id]) })),
    liveModelCount: async () => state.liveModels,
    slotOwners: async () => state.owners,
    update: async (kind, id, patch, userId) => {
      state.writes.push({ kind, id, patch, userId });
      return true;
    },
    parseGroupName,
  };
  return state;
};

const setup = (extra) => {
  const state = fakeStore(extra);
  return { state, ops: createCatalogEditOps(state.store) };
};

// --- вендор --------------------------------------------------------------------

test("updateVendor: имя — before -> after, check без записи, apply пишет с автором", async () => {
  const { state, ops } = setup();
  const check = await ops.checkUpdateVendor({ id: VENDOR, name: "Hewlett-Packard" });
  assert.deepEqual(check, { ok: true, before: { name: "HP" } });
  assert.equal(state.writes.length, 0);
  const applied = await ops.applyUpdateVendor({ id: VENDOR, name: "Hewlett-Packard" }, { userId: USER });
  assert.deepEqual(applied, { ok: true, id: VENDOR });
  assert.deepEqual(state.writes, [{ kind: "vendor", id: VENDOR, patch: { name: "Hewlett-Packard" }, userId: USER }]);
});

test("updateVendor: имя занято — отказ; скрытым — своим текстом; пустое — 400", async () => {
  const { ops, state } = setup({ holders: { vendor: { Lenovo: { _id: VENDOR2, name: "Lenovo" }, Старый: { _id: HIDDEN_VENDOR, name: "Старый", isActive: false } } } });
  assert.deepEqual(await ops.checkUpdateVendor({ id: VENDOR, name: "Lenovo" }), {
    ok: false,
    status: 409,
    message: "Вендор «Lenovo» уже есть",
  });
  const hidden = await ops.checkUpdateVendor({ id: VENDOR, name: "Старый" });
  assert.match(hidden.message, /имя занято скрытой записью «Старый»/);
  assert.equal((await ops.checkUpdateVendor({ id: VENDOR, name: "  " })).status, 400);
  assert.equal(state.writes.length, 0);
});

test("updateVendor: скрытый — можно вернуть isActive:true, before «нет»", async () => {
  const { ops, state } = setup();
  const check = await ops.checkUpdateVendor({ id: HIDDEN_VENDOR, isActive: true });
  assert.deepEqual(check, { ok: true, before: { isActive: "нет" } });
  await ops.applyUpdateVendor({ id: HIDDEN_VENDOR, isActive: true }, { userId: USER });
  assert.deepEqual(state.writes[0].patch, { isActive: true });
});

test("updateVendor: ничего не меняется — отказ, при применении (allowNoop) — не ошибка и без записи", async () => {
  const { ops, state } = setup();
  const check = await ops.checkUpdateVendor({ id: VENDOR, name: "HP", isActive: true });
  assert.equal(check.ok, false);
  assert.match(check.message, /Ничего не меняется/);
  assert.deepEqual(await ops.checkUpdateVendor({ id: VENDOR, name: "HP" }, { allowNoop: true }), { ok: true, before: {} });
  assert.deepEqual(await ops.applyUpdateVendor({ id: VENDOR, name: "HP" }, { userId: USER }), { ok: true, id: VENDOR });
  assert.equal(state.writes.length, 0);
});

// --- поставщик -----------------------------------------------------------------

test("updateSupplier: поля и очистка; before — «не задано» для пустого", async () => {
  const { ops, state } = setup();
  const patch = { id: SUPPLIER, website: "", kpp: "770001001", notes: "основной", isActive: false };
  const check = await ops.checkUpdateSupplier(patch);
  assert.deepEqual(check, {
    ok: true,
    before: { isActive: "да", website: "citilink.ru", kpp: "не задано", notes: "не задано" },
  });
  await ops.applyUpdateSupplier(patch, { userId: USER });
  assert.deepEqual(state.writes[0].patch, { isActive: false, website: undefined, kpp: "770001001", notes: "основной" });
});

test("updateSupplier: имя занято — отказ; не строка — 400", async () => {
  const { ops } = setup({ holders: { supplier: { Регард: { _id: "x", name: "Регард" } } } });
  assert.deepEqual(await ops.checkUpdateSupplier({ id: SUPPLIER, name: "Регард" }), {
    ok: false,
    status: 409,
    message: "Поставщик «Регард» уже есть в справочнике",
  });
  assert.equal((await ops.checkUpdateSupplier({ id: SUPPLIER, inn: 7700 })).status, 400);
});

// --- модель --------------------------------------------------------------------

test("updateModel: имена вместо id в before, список совместимых заменяется", async () => {
  const { ops, state } = setup();
  const args = { id: MODEL, vendorId: VENDOR2, notes: "новая", compatibleWithModelIds: [MODEL3], name: "ProBook 450" };
  const check = await ops.checkUpdateModel(args);
  assert.deepEqual(check, {
    ok: true,
    before: { name: "ProBook", vendorId: "HP", notes: "старая", compatibleWithModelIds: "HP EliteBook" },
  });
  await ops.applyUpdateModel(args, { userId: USER });
  assert.deepEqual(state.writes[0].patch, {
    name: "ProBook 450",
    vendorId: VENDOR2,
    notes: "новая",
    compatibleWithModelIds: [MODEL3],
  });
});

test("updateModel: имя занято среди живых; удалённая модель, скрытый вендор, сама с собой — отказ", async () => {
  const { ops } = setup({ holders: { model: { EliteBook: { _id: MODEL2, name: "EliteBook" } } } });
  assert.equal((await ops.checkUpdateModel({ id: MODEL, name: "EliteBook" })).message, "Модель «EliteBook» уже есть");
  assert.deepEqual(await ops.checkUpdateModel({ id: DELETED_MODEL, notes: "x" }), { ok: false, status: 404, message: "Модель удалена" });
  assert.equal((await ops.checkUpdateModel({ id: MODEL, vendorId: HIDDEN_VENDOR })).message, "Вендор «Старый» скрыт");
  assert.equal((await ops.checkUpdateModel({ id: MODEL, compatibleWithModelIds: [MODEL] })).status, 400);
  assert.equal((await ops.checkUpdateModel({ id: MODEL, compatibleWithModelIds: [DELETED_MODEL] })).status, 400);
});

test("updateModel: multiConfig — не поле вида, сервис его не пишет", async () => {
  const { ops, state } = setup();
  await ops.applyUpdateModel({ id: MODEL, notes: "x", multiConfig: true }, { userId: USER });
  assert.deepEqual(state.writes[0].patch, { notes: "x" });
});

// --- тип -----------------------------------------------------------------------

test("updateDeviceType: флаги, префикс (заглавными), список «прикрепляется к»", async () => {
  const { ops, state } = setup();
  // Назначение одно: перевод в расходники снимает «комплектующее» явно
  const args = { id: TYPE, isComponent: false, isConsumable: true, inventoryPrefix: "нб2", attachableToTypeIds: [], name: "Ноутбуки" };
  const check = await ops.checkUpdateDeviceType(args);
  assert.deepEqual(check, {
    ok: true,
    before: { name: "Ноутбук", isComponent: "да", isConsumable: "нет", inventoryPrefix: "НБ", attachableToTypeIds: "Док-станция" },
  });
  await ops.applyUpdateDeviceType(args, { userId: USER });
  assert.deepEqual(state.writes[0].patch, {
    name: "Ноутбуки",
    isComponent: false,
    isConsumable: true,
    inventoryPrefix: "НБ2",
    attachableToTypeIds: [],
  });
});

test("updateDeviceType: второе назначение поверх первого — отказ", async () => {
  const { ops, state } = setup();
  const result = await ops.checkUpdateDeviceType({ id: TYPE, isPeripheral: true });
  assert.deepEqual(result, {
    ok: false,
    status: 400,
    message: "У типа одно назначение: комплектующее, расходник или периферия — не несколько сразу",
  });
  assert.equal(state.writes.length, 0);
});

test("updateDeviceType: isComponent:false у типа в чужом слоте — отказ", async () => {
  const { ops, state } = setup({ owners: ["Системный блок"] });
  const result = await ops.checkUpdateDeviceType({ id: TYPE, isComponent: false });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.message, "Нельзя снять «комплектующее» у типа «Ноутбук»: он стоит в слоте типов «Системный блок»");
  // без слота — можно
  state.owners = [];
  assert.deepEqual(await ops.checkUpdateDeviceType({ id: TYPE, isComponent: false }), { ok: true, before: { isComponent: "да" } });
});

test("updateDeviceType: isActive:false при живых моделях — отказ; без моделей можно", async () => {
  const { ops, state } = setup({ liveModels: 3 });
  assert.deepEqual(await ops.checkUpdateDeviceType({ id: TYPE, isActive: false }), {
    ok: false,
    status: 409,
    message: "Нельзя скрыть тип «Ноутбук»: у него есть модели (3)",
  });
  state.liveModels = 0;
  assert.deepEqual(await ops.checkUpdateDeviceType({ id: TYPE, isActive: false }), { ok: true, before: { isActive: "да" } });
});

test("updateDeviceType: тип сам к себе и несуществующий тип — отказ", async () => {
  const { ops } = setup();
  assert.equal((await ops.checkUpdateDeviceType({ id: TYPE, attachableToTypeIds: [TYPE] })).status, 400);
  assert.equal((await ops.checkUpdateDeviceType({ id: TYPE, attachableToTypeIds: ["eeeeeeeeeeeeeeeeeeeeeee9"] })).status, 400);
});

test("updateDeviceType: имя занято — отказ, имя тип-уникально с учётом регистра (holder решает store)", async () => {
  const { ops, state } = setup({ holders: { type: { Моноблок: { _id: "x", name: "Моноблок" } } } });
  assert.deepEqual(await ops.checkUpdateDeviceType({ id: TYPE, name: "Моноблок" }), {
    ok: false,
    status: 409,
    message: "Тип «Моноблок» уже есть",
  });
  assert.equal(state.writes.length, 0);
});

// --- группа --------------------------------------------------------------------

test("updateGroup: имя и порядок; имя занято — отказ (регистр решает коллация живого store, здесь holder задан подделкой)", async () => {
  const { ops, state } = setup();
  const check = await ops.checkUpdateGroup({ id: GROUP, name: "  ЦПУ ", order: 5 });
  assert.deepEqual(check, { ok: true, before: { name: "Процессор", order: "2" } });
  await ops.applyUpdateGroup({ id: GROUP, name: "ЦПУ", order: 5 }, { userId: USER });
  assert.deepEqual(state.writes[0].patch, { name: "ЦПУ", order: 5 });
  state.holders.group = { ПАМЯТЬ: { _id: "x", name: "память" } };
  assert.deepEqual(await ops.checkUpdateGroup({ id: GROUP, name: "ПАМЯТЬ" }), {
    ok: false,
    status: 409,
    message: "Группа «ПАМЯТЬ» уже есть",
  });
  assert.equal((await ops.checkUpdateGroup({ id: GROUP, name: " " })).status, 400);
});

// --- атрибут, связь, конфигурация, сборка (Task 4) ------------------------------

const { parseBuildParts } = require("@/controllers/inventory/deviceBuild");

const ATTR = "a0000000000000000000a001";
const ATTR_MULTI = "a0000000000000000000a002";
const ATTR_NUM = "a0000000000000000000a003";
const ATTR_HIDDEN = "a0000000000000000000a004";
const LINK = "1000000000000000000000a1";
const C1 = "c00000000000000000000001";
const C2 = "c00000000000000000000002";
const C3 = "c00000000000000000000003";
const C4 = "c00000000000000000000004";
const CONF = "c000000000000000000000f1";
const DELETED_CONF = "c000000000000000000000f9";
const BUILD = "b0000000000000000000b001";
const RAM_TYPE = "eeeeeeeeeeeeeeeeeeeeeee3";
const SSD_TYPE = "eeeeeeeeeeeeeeeeeeeeeee4";

const LINK_AT = new Date("2026-10-01T10:00:00Z");
const opts = (values) => values.map((value) => ({ value, label: value }));

// Подделка для видов Task 4: документы и выборки поверх fakeStore, update применяет патч
const fakeStore4 = (extra = {}) => {
  const state = fakeStore();
  const { docs } = state;
  docs.attribute = {
    [ATTR]: { _id: ATTR, code: "mem_type", name: "Тип памяти", valueType: "select", options: opts(["DDR-4", "DDR5"]), isActive: true },
    [ATTR_MULTI]: { _id: ATTR_MULTI, code: "mem_std", name: "Стандарты", valueType: "multiselect", options: opts(["DDR-4", "DDR5"]) },
    [ATTR_NUM]: { _id: ATTR_NUM, code: "ram_gb", name: "Объём ОЗУ", valueType: "number", unit: "ГБ", options: [] },
    [ATTR_HIDDEN]: { _id: ATTR_HIDDEN, code: "old", name: "Старый", valueType: "string", isActive: false },
  };
  docs.configuration = {
    [CONF]: {
      _id: CONF,
      name: "16/512",
      deviceModelId: MODEL,
      values: [
        { attributeId: ATTR_NUM, value: "16" },
        { attributeId: ATTR, value: "DDR5" },
      ],
    },
    [DELETED_CONF]: { _id: DELETED_CONF, name: "Старая", deviceModelId: MODEL, values: [], deletedAt: new Date() },
  };
  docs.model[MODEL].deviceTypeId = TYPE;
  docs.build = {
    [BUILD]: {
      _id: BUILD,
      name: "Офисный",
      deviceTypeId: TYPE2,
      notes: "",
      parts: [{ typeId: RAM_TYPE, deviceModelId: MODEL2, configurationId: null, quantity: 1 }],
    },
  };
  Object.assign(state, {
    configValues: {},
    rewrites: [],
    links: { [`${TYPE}:${ATTR_NUM}`]: { _id: LINK, required: false, order: 0, groupId: null, updatedAt: LINK_AT } },
    linkWrites: [],
    deleted: [],
    keyOwners: [],
    valueCount: 0,
    slots: [
      { typeId: RAM_TYPE, typeName: "ОЗУ", required: true, multiple: true },
      { typeId: SSD_TYPE, typeName: "Накопитель", required: false, multiple: false },
    ],
    ...extra,
  });
  const base = state.store;
  state.store = {
    ...base,
    update: async (kind, id, patch, userId) => {
      await base.update(kind, id, patch, userId);
      Object.assign(docs[kind][String(id)], patch);
      return true;
    },
    configValues: async (attributeId) => state.configValues[String(attributeId)] ?? [],
    deviceValues: async (attributeId) => state.deviceValues?.[String(attributeId)] ?? [],
    rewriteDeviceValue: async (id, attributeId, oldValue, newValue, userId) => {
      (state.deviceRewrites ??= []).push({ id, oldValue, newValue, userId });
      return true;
    },
    rewriteValue: async (id, attributeId, oldValue, newValue, userId) => {
      const row = (state.configValues[String(attributeId)] ?? []).find((r) => r._id === id);
      if (!row || row.value !== oldValue) return false;
      row.value = newValue;
      state.rewrites.push({ id, oldValue, newValue, userId });
      return true;
    },
    typeLink: async (typeId, attributeId) => state.links[`${typeId}:${attributeId}`] ?? null,
    updateLink: async (linkId, patch, userId) => {
      state.linkWrites.push({ linkId, patch, userId });
      return true;
    },
    deleteLink: async (linkId) => {
      state.deleted.push(linkId);
      return true;
    },
    keySpecOwners: async () => state.keyOwners,
    typeValueCount: async () => state.valueCount,
    typeDeviceValueCount: async () => state.deviceValueCount ?? 0,
    attributesByCode: async (codes) => Object.values(docs.attribute).filter((a) => codes.includes(a.code)),
    linkedAttributeIds: async () => [ATTR, ATTR_MULTI, ATTR_NUM],
    // Правила сборки — те же parseBuildParts контроллера; ссылки моделей не проверяем
    buildFields: async (_typeId, body) => {
      const parsed = parseBuildParts(body.parts, state.slots);
      return parsed.error ? { error: { status: 400, message: parsed.error } } : { parts: parsed.parts };
    },
  };
  return state;
};

const setup4 = (extra) => {
  const state = fakeStore4(extra);
  return { state, ops: createCatalogEditOps(state.store) };
};

const RENAME = [{ from: "DDR-4", to: "DDR4" }];

test("renameOptions: select — значения переписаны по списку", async () => {
  const { state, ops } = setup4({
    configValues: {
      [ATTR]: [
        { _id: C1, value: "DDR-4" },
        { _id: C2, value: "DDR5" },
        { _id: C3, value: "DDR-4", deletedAt: new Date() },
      ],
    },
  });
  const check = await ops.checkUpdateAttribute({ id: ATTR, renameOptions: RENAME });
  assert.equal(check.ok, true);
  const snapshot = [
    {
      model: "DeviceConfiguration",
      path: "values.value",
      attributeId: ATTR,
      code: "mem_type",
      option: "DDR-4",
      ids: [C1, C3],
      live: 1,
      deleted: 1,
      deletedIds: [C3],
    },
  ];
  assert.deepEqual(check.refs, snapshot);
  assert.deepEqual(check.renames, [{ from: "DDR-4", to: "DDR4", live: 1, deleted: 1 }]);
  assert.equal(state.writes.length, 0);

  const applied = await ops.applyUpdateAttribute({ id: ATTR, renameOptions: RENAME }, { userId: USER, snapshot });
  assert.deepEqual(applied, { ok: true, id: ATTR });
  assert.deepEqual(state.writes[0].patch, { options: opts(["DDR4", "DDR5"]) });
  assert.deepEqual(state.rewrites, [
    { id: C1, oldValue: "DDR-4", newValue: "DDR4", userId: USER },
    { id: C3, oldValue: "DDR-4", newValue: "DDR4", userId: USER },
  ]);
  // Повтор (сбой после записи атрибута): вариант уже переименован — ничего второй раз
  assert.deepEqual(await ops.applyUpdateAttribute({ id: ATTR, renameOptions: RENAME }, { userId: USER, snapshot }), {
    ok: true,
    id: ATTR,
  });
  assert.equal(state.rewrites.length, 2);
});

test("renameOptions: атрибут устройства — переписаны значения устройств", async () => {
  const { state, ops } = setup4({
    deviceValues: {
      [ATTR]: [
        { _id: "dev1", value: "DDR-4" },
        { _id: "dev2", value: "DDR5" },
      ],
    },
  });
  state.docs.attribute[ATTR].scope = "device";
  const check = await ops.checkUpdateAttribute({ id: ATTR, renameOptions: RENAME });
  assert.equal(check.ok, true);
  assert.equal(state.deviceRewrites, undefined);
  const applied = await ops.applyUpdateAttribute({ id: ATTR, renameOptions: RENAME }, { userId: USER, snapshot: check.refs });
  assert.deepEqual(applied, { ok: true, id: ATTR });
  assert.deepEqual(state.deviceRewrites, [{ id: "dev1", oldValue: "DDR-4", newValue: "DDR4", userId: USER }]);
});

test("renameOptions: multiselect — элемент массива, без дублей", async () => {
  const { state, ops } = setup4({
    configValues: {
      [ATTR_MULTI]: [
        { _id: C1, value: '["DDR-4","DDR4"]' },
        { _id: C2, value: '["DDR5","DDR-4"]' },
        { _id: C3, value: '["DDR5"]' },
      ],
    },
  });
  const check = await ops.checkUpdateAttribute({ id: ATTR_MULTI, renameOptions: RENAME });
  assert.equal(check.ok, true);
  assert.deepEqual(check.refs[0].ids, [C1, C2]);
  await ops.applyUpdateAttribute({ id: ATTR_MULTI, renameOptions: RENAME }, { userId: USER, snapshot: check.refs });
  assert.deepEqual(
    state.rewrites.map(({ id, newValue }) => ({ id, newValue })),
    [
      { id: C1, newValue: '["DDR4"]' },
      { id: C2, newValue: '["DDR5","DDR4"]' },
    ],
  );
});

test("renameOptions: при утверждении новая конфигурация — дрейф", async () => {
  const { state, ops } = setup4({ configValues: { [ATTR]: [{ _id: C1, value: "DDR-4" }] } });
  const check = await ops.checkUpdateAttribute({ id: ATTR, renameOptions: RENAME });
  state.configValues[ATTR].push({ _id: C4, value: "DDR-4" });
  const args = { id: ATTR, renameOptions: RENAME };
  const atApply = await ops.checkUpdateAttribute(args, { allowNoop: true, snapshot: check.refs });
  assert.equal(atApply.ok, false);
  assert.equal(atApply.message, "изменилось после предложения: вариант «DDR-4» появился ещё в 1 конфигурации");
  assert.deepEqual(await ops.applyUpdateAttribute(args, { userId: USER, snapshot: check.refs }), atApply);
  // Без снимка переименование не применяется
  assert.match((await ops.applyUpdateAttribute(args, { userId: USER, snapshot: null })).message, /^изменилось после предложения: /);
  assert.equal(state.writes.length, 0);
  assert.equal(state.rewrites.length, 0);
});

test("updateAttribute: имя занято по name_1 — отказ; скрытым — своим текстом", async () => {
  const { ops, state } = setup4({
    holders: { attribute: { ОЗУ: { _id: "x", name: "ОЗУ" }, Старый: { _id: ATTR_HIDDEN, name: "Старый", isActive: false } } },
  });
  assert.deepEqual(await ops.checkUpdateAttribute({ id: ATTR, name: "ОЗУ" }), {
    ok: false,
    status: 409,
    message: "Атрибут «ОЗУ» уже есть",
  });
  assert.match((await ops.checkUpdateAttribute({ id: ATTR, name: "Старый" })).message, /имя занято скрытой записью «Старый»/);
  assert.equal(state.writes.length, 0);
});

test("updateAttribute: имя, единица, скрытие и новые варианты; valueType не пишется", async () => {
  const { ops, state } = setup4();
  const check = await ops.checkUpdateAttribute({ id: ATTR_NUM, name: "ОЗУ", unit: "МБ", isActive: false });
  assert.deepEqual(check, { ok: true, before: { name: "Объём ОЗУ", unit: "ГБ", isActive: "да" }, refs: [], renames: [], added: [] });
  const added = await ops.checkUpdateAttribute({ id: ATTR, addOptions: [" LPDDR5X ", "LPDDR5X"] });
  assert.deepEqual(added.added, ["LPDDR5X"]);
  await ops.applyUpdateAttribute({ id: ATTR, addOptions: ["LPDDR5X"], valueType: "string" }, { userId: USER });
  assert.deepEqual(state.writes[0].patch, { options: opts(["DDR-4", "DDR5", "LPDDR5X"]) });
});

test("updateAttribute: варианты — отказы", async () => {
  const { ops } = setup4();
  assert.equal((await ops.checkUpdateAttribute({ id: ATTR_NUM, addOptions: ["x"] })).message, "У атрибута «Объём ОЗУ» нет вариантов");
  assert.equal((await ops.checkUpdateAttribute({ id: ATTR, addOptions: ["DDR5"] })).message, "Вариант «DDR5» уже есть у атрибута «Тип памяти»");
  assert.equal(
    (await ops.checkUpdateAttribute({ id: ATTR, renameOptions: [{ from: "DDR-4", to: "DDR5" }] })).message,
    "Вариант «DDR5» уже есть у атрибута «Тип памяти»",
  );
  assert.equal(
    (await ops.checkUpdateAttribute({ id: ATTR, renameOptions: [{ from: "DDR3", to: "DDR4" }] })).message,
    "Варианта «DDR3» нет у атрибута «Тип памяти»",
  );
  assert.equal(
    (await ops.checkUpdateAttribute({ id: ATTR, addOptions: ["DDR4"], renameOptions: RENAME })).message,
    "Вариант «DDR4» указан дважды",
  );
});

test("updateTypeAttribute: обязательность, порядок, группа; связи нет — 404", async () => {
  const { ops, state } = setup4();
  const args = { type: TYPE, attribute: ATTR_NUM, required: true, order: 3, groupId: GROUP };
  const check = await ops.checkUpdateTypeAttribute(args);
  // Связь — цель сверки дрейфа: правка связи после предложения — дрейф, а не тихая перезапись
  assert.deepEqual(check, {
    ok: true,
    before: { required: "нет", order: "0", groupId: "без группы" },
    targets: [{ model: "DeviceTypeAttribute", id: LINK, updatedAt: LINK_AT }],
  });
  await ops.applyUpdateTypeAttribute(args, { userId: USER });
  assert.deepEqual(state.linkWrites, [{ linkId: LINK, patch: { required: true, order: 3, groupId: GROUP }, userId: USER }]);
  assert.deepEqual(await ops.checkUpdateTypeAttribute({ type: TYPE, attribute: ATTR, required: true }), {
    ok: false,
    status: 404,
    message: "Атрибут «Тип памяти» не привязан к типу «Ноутбук»",
  });
});

test("unlinkAttribute: в keySpecs — отказ", async () => {
  const { ops, state } = setup4({ keyOwners: ["Системный блок"] });
  assert.deepEqual(await ops.checkUnlinkAttribute({ type: TYPE, attribute: ATTR_NUM }), {
    ok: false,
    status: 409,
    message: "Атрибут «Объём ОЗУ» стоит в ключевых характеристиках типов «Системный блок»: сначала уберите его оттуда",
  });
  assert.equal(state.deleted.length, 0);
});

test("unlinkAttribute: значения у устройств типа — отказ", async () => {
  const { ops, state } = setup4({ deviceValueCount: 15 });
  assert.deepEqual(await ops.checkUnlinkAttribute({ type: TYPE, attribute: ATTR_NUM }), {
    ok: false,
    status: 409,
    message: "У устройств типа «Ноутбук» есть значения атрибута «Объём ОЗУ» (15): сначала уберите их",
  });
  assert.equal((await ops.applyUnlinkAttribute({ type: TYPE, attribute: ATTR_NUM }, { userId: USER })).status, 409);
  assert.equal(state.deleted.length, 0);
});

test("unlinkAttribute: есть значения — отказ; без значений — связь снимается", async () => {
  const { ops, state } = setup4({ valueCount: 2 });
  assert.deepEqual(await ops.checkUnlinkAttribute({ type: TYPE, attribute: ATTR_NUM }), {
    ok: false,
    status: 409,
    message: "У конфигураций моделей типа «Ноутбук» есть значения атрибута «Объём ОЗУ» (2): сначала уберите их",
  });
  state.valueCount = 0;
  assert.deepEqual(await ops.checkUnlinkAttribute({ type: TYPE, attribute: ATTR_NUM }), { ok: true, before: {} });
  assert.deepEqual(await ops.applyUnlinkAttribute({ type: TYPE, attribute: ATTR_NUM }, { userId: USER }), { ok: true, id: LINK });
  assert.deepEqual(state.deleted, [LINK]);
  // Повтор: связи уже нет — при применении не ошибка, при предложении — 404
  delete state.links[`${TYPE}:${ATTR_NUM}`];
  assert.equal((await ops.applyUnlinkAttribute({ type: TYPE, attribute: ATTR_NUM }, { userId: USER })).ok, true);
  assert.equal((await ops.checkUnlinkAttribute({ type: TYPE, attribute: ATTR_NUM })).status, 404);
});

test("updateConfiguration: атрибут уровня устройства — отказ, даже связанный", async () => {
  const { ops, state } = setup4();
  state.docs.attribute[ATTR_NUM].scope = "device";
  assert.deepEqual(await ops.checkUpdateConfiguration({ id: CONF, setValues: [{ attribute: "ram_gb", value: "32" }] }), {
    ok: false,
    status: 400,
    message: "Атрибут «Объём ОЗУ» задаётся у каждого устройства, а не у модели",
  });
  assert.equal(state.writes.length, 0);
});

test("updateConfiguration: значение не по options — отказ", async () => {
  const { ops, state } = setup4();
  assert.deepEqual(await ops.checkUpdateConfiguration({ id: CONF, setValues: [{ attribute: "mem_type", value: "DDR3" }] }), {
    ok: false,
    status: 400,
    message: "Значение «DDR3» не подходит атрибуту «Тип памяти»",
  });
  // Скрытый — отказ раньше проверки связи; живой несвязанный — «не относится»
  assert.equal(
    (await ops.checkUpdateConfiguration({ id: CONF, setValues: [{ attribute: "old", value: "x" }] })).message,
    "Атрибут «Старый» скрыт",
  );
  state.docs.attribute[ATTR_HIDDEN].isActive = true;
  assert.equal(
    (await ops.checkUpdateConfiguration({ id: CONF, setValues: [{ attribute: "old", value: "x" }] })).message,
    "Атрибут «Старый» не относится к типу «Ноутбук»",
  );
  assert.equal((await ops.checkUpdateConfiguration({ id: CONF, setValues: [{ attribute: "nope", value: "x" }] })).message, "Атрибут «nope» не найден");
  assert.equal((await ops.checkUpdateConfiguration({ id: DELETED_CONF, name: "x" })).message, "Конфигурация удалена");
  assert.equal(state.writes.length, 0);
});

test("updateConfiguration: значения задаются и снимаются, было → стало", async () => {
  const { ops, state } = setup4();
  const args = {
    id: CONF,
    name: "32/512",
    setValues: [
      { attribute: "ram_gb", value: 32 },
      { attribute: "mem_std", value: ["DDR5"] },
    ],
    clearValues: ["mem_type"],
  };
  const check = await ops.checkUpdateConfiguration(args);
  assert.deepEqual(check, {
    ok: true,
    before: { name: "16/512" },
    values: [
      { field: "setValues", name: "Объём ОЗУ", value: "32 ГБ", before: "16 ГБ" },
      { field: "setValues", name: "Стандарты", value: "DDR5", before: "не задано" },
      { field: "clearValues", name: "Тип памяти", value: null, before: "DDR5" },
    ],
  });
  await ops.applyUpdateConfiguration(args, { userId: USER });
  assert.deepEqual(state.writes[0].patch, {
    name: "32/512",
    values: [
      { attributeId: ATTR_NUM, value: "32" },
      { attributeId: ATTR_MULTI, value: '["DDR5"]' },
    ],
  });
  // Те же значения ещё раз — ничего не меняется
  assert.match((await ops.checkUpdateConfiguration({ id: CONF, setValues: [{ attribute: "ram_gb", value: "32" }] })).message, /Ничего не меняется/);
});

test("updateBuild: части по правилам сборки", async () => {
  const { ops, state } = setup4();
  const bad = await ops.checkUpdateBuild({ id: BUILD, parts: [{ typeId: SSD_TYPE, deviceModelId: MODEL3, quantity: 1 }] });
  assert.deepEqual(bad, { ok: false, status: 400, message: "Не заполнено: ОЗУ" });
  const two = await ops.checkUpdateBuild({
    id: BUILD,
    parts: [
      { typeId: SSD_TYPE, deviceModelId: MODEL3 },
      { typeId: SSD_TYPE, deviceModelId: MODEL3 },
    ],
  });
  assert.equal(two.message, "В слот «Накопитель» — только одна деталь");
  const parts = [
    { typeId: RAM_TYPE, deviceModelId: MODEL2, quantity: 2 },
    { typeId: SSD_TYPE, deviceModelId: MODEL3 },
  ];
  const check = await ops.checkUpdateBuild({ id: BUILD, name: "Офисный 2", parts });
  assert.deepEqual(check, { ok: true, before: { name: "Офисный", parts: "HP EliteBook" } });
  await ops.applyUpdateBuild({ id: BUILD, name: "Офисный 2", parts }, { userId: USER });
  assert.deepEqual(state.writes[0].patch, {
    name: "Офисный 2",
    parts: [
      { typeId: RAM_TYPE, deviceModelId: MODEL2, configurationId: null, quantity: 2 },
      { typeId: SSD_TYPE, deviceModelId: MODEL3, configurationId: null, quantity: 1 },
    ],
  });
  // Те же детали ещё раз — ничего не меняется
  assert.match((await ops.checkUpdateBuild({ id: BUILD, parts })).message, /Ничего не меняется/);
  assert.equal((await ops.checkUpdateBuild({ id: BUILD, name: " " })).message, "Укажите название сборки");
});

test("renameOptions: повтор после сбоя — переписан только остаток, уже переписанные не тронуты", async () => {
  // Состояние после сбоя: варианты атрибута уже переименованы, C1 переписана, C3 — нет
  const { state, ops } = setup4({
    configValues: {
      [ATTR]: [
        { _id: C1, value: "DDR4" },
        { _id: C2, value: "DDR5" },
        { _id: C3, value: "DDR-4" },
      ],
    },
  });
  state.docs.attribute[ATTR].options = opts(["DDR4", "DDR5"]);
  const snapshot = [
    { model: "DeviceConfiguration", path: "values.value", attributeId: ATTR, option: "DDR-4", ids: [C1, C3], live: 2, deleted: 0, deletedIds: [] },
  ];
  assert.deepEqual(await ops.applyUpdateAttribute({ id: ATTR, renameOptions: RENAME }, { userId: USER, snapshot }), { ok: true, id: ATTR });
  assert.equal(state.writes.length, 0);
  assert.deepEqual(state.rewrites, [{ id: C3, oldValue: "DDR-4", newValue: "DDR4", userId: USER }]);
  assert.deepEqual(state.configValues[ATTR].map((row) => row.value), ["DDR4", "DDR5", "DDR4"]);
});

// ─── Финальная правка фазы 4 ──────────────────────────────────────────────────

test("updateConfiguration: скрытый атрибут в setValues по коду — отказ «Атрибут «X» скрыт»", async () => {
  const { ops, state } = setup4();
  state.docs.attribute[ATTR_NUM].isActive = false;
  const args = { id: CONF, setValues: [{ attribute: "ram_gb", value: "32" }] };
  assert.deepEqual(await ops.checkUpdateConfiguration(args), { ok: false, status: 400, message: "Атрибут «Объём ОЗУ» скрыт" });
  assert.equal((await ops.applyUpdateConfiguration(args, { userId: USER })).message, "Атрибут «Объём ОЗУ» скрыт");
  // Снять значение скрытого атрибута можно: так его чистят
  const clear = await ops.checkUpdateConfiguration({ id: CONF, clearValues: ["ram_gb"] });
  assert.equal(clear.ok, true, clear.message);
  assert.equal(state.writes.length, 0);
});
