// node --test services/inventory/catalogMerge.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCatalogMerge } = require("./catalogMerge");
const { createCatalogRefs } = require("./catalogRefs");

const oid = (c, n) => c.repeat(22) + n.toString(16).padStart(2, "0");
const TYPE1 = oid("e", 1);
const TYPE2 = oid("e", 2);
const VA = oid("f", 1);
const VB = oid("f", 2);
const V_HIDDEN = oid("f", 3);
const SRC = oid("b", 1);
const TGT = oid("b", 2);
const OTHER1 = oid("b", 3);
const OTHER2 = oid("b", 4);
const MONO = oid("b", 5);
const DEAD = oid("b", 6);
const D1 = oid("a", 1);
const D2 = oid("a", 2);
const D3 = oid("a", 3);
const D4 = oid("a", 4);
const D5 = oid("a", 5);
const C1 = oid("c", 1);
const C2 = oid("c", 2);
const C3 = oid("c", 3);
const C_EMPTY = oid("c", 4);
const B1 = oid("d", 1);
const G1 = oid("9", 1);
const G2 = oid("9", 2);
const L1 = oid("8", 1);
const L2 = oid("8", 2);
const L3 = oid("8", 3);
const S1 = oid("5", 1);
const S2 = oid("5", 2);
const USER = oid("3", 1);
const NOW = new Date("2026-10-28T10:00:00Z");
const OLD = new Date("2026-10-01T10:00:00Z");

// Значения по пути документа: массивы раскрываются, как в Mongo
const valuesAt = (doc, path) =>
  path
    .split(".")
    .reduce((vals, key) => vals.flatMap((v) => (v == null ? [] : Array.isArray(v[key]) ? v[key] : [v[key]])), [doc]);
const getAt = (doc, path) => path.split(".").reduce((v, key) => v?.[key], doc);

// «База» в памяти: refs-хранилище для catalogRefs и store слияния поверх одних данных.
// Каждая запись пишется в writes; crashAt — номер вызова rewire, который упадёт (один раз)
const world = () => {
  const db = {
    DeviceType: {
      [TYPE1]: { _id: TYPE1, name: "Ноутбук" },
      [TYPE2]: { _id: TYPE2, name: "Моноблок" },
    },
    Vendor: {
      [VA]: { _id: VA, name: "Lenovo", isActive: true, updatedAt: OLD },
      [VB]: { _id: VB, name: "Lenovo Group", isActive: true, updatedAt: OLD },
      [V_HIDDEN]: { _id: V_HIDDEN, name: "Старый", isActive: false, updatedAt: OLD },
    },
    Supplier: {
      [S1]: { _id: S1, name: "Ситилинк", isActive: true },
      [S2]: { _id: S2, name: "Citilink", isActive: true },
    },
    DeviceModel: {
      [SRC]: { _id: SRC, name: "T14 G4", vendorId: VA, deviceTypeId: TYPE1, compatibleWithModelIds: [OTHER1, TGT], multiConfig: false },
      [TGT]: { _id: TGT, name: "T14 Gen 4", vendorId: VB, deviceTypeId: TYPE1, compatibleWithModelIds: [SRC], multiConfig: true },
      [OTHER1]: { _id: OTHER1, name: "Док", vendorId: VA, deviceTypeId: TYPE1, compatibleWithModelIds: [SRC] },
      [OTHER2]: { _id: OTHER2, name: "Порт", vendorId: VA, deviceTypeId: TYPE1, compatibleWithModelIds: [SRC, TGT] },
      [MONO]: { _id: MONO, name: "AIO", vendorId: VA, deviceTypeId: TYPE2, compatibleWithModelIds: [] },
      [DEAD]: { _id: DEAD, name: "Old", vendorId: VA, deviceTypeId: TYPE1, deletedAt: OLD },
    },
    DeviceConfiguration: {
      [C1]: { _id: C1, name: "16/512", deviceModelId: SRC, values: [{ attributeId: "x", value: "16" }] },
      [C2]: { _id: C2, name: "8/256", deviceModelId: SRC, values: [{ attributeId: "x", value: "8" }], deletedAt: OLD },
      [C3]: { _id: C3, name: "32/1T", deviceModelId: TGT, values: [{ attributeId: "x", value: "32" }] },
    },
    ClientDevice: {
      [D1]: { _id: D1, label: "Ноутбук NB-000101", deviceModelId: SRC, configurationId: C1, supplierId: S1 },
      [D2]: { _id: D2, label: "Ноутбук NB-000102", deviceModelId: SRC, configurationId: C1, supplierId: S1 },
      [D3]: { _id: D3, label: "Ноутбук NB-000103", deviceModelId: SRC, configurationId: C2, deletedAt: OLD },
      [D4]: { _id: D4, label: "Ноутбук NB-000104", deviceModelId: TGT, configurationId: C3, supplierId: S1 },
    },
    DeviceBuild: {
      [B1]: { _id: B1, name: "Офисный", deviceTypeId: TYPE1, parts: [{ deviceModelId: SRC }, { deviceModelId: OTHER1 }] },
    },
    AttributeGroup: {
      [G1]: { _id: G1, name: "Процессор " },
      [G2]: { _id: G2, name: "Процессор" },
    },
    DeviceTypeAttribute: {
      [L1]: { _id: L1, groupId: G1 },
      [L2]: { _id: L2, groupId: G1 },
      [L3]: { _id: L3, groupId: G2 },
    },
    Location: {},
    DeviceAttribute: {},
  };
  const state = { db, writes: [], rewires: [], crashAt: null, calls: 0 };
  const hidden = (doc) => Boolean(doc.deletedAt) || doc.isActive === false;
  const nameOf = (model, doc) => {
    if (model === "ClientDevice") return doc.label;
    if (model === "DeviceModel") return [db.Vendor[doc.vendorId]?.name, doc.name].filter(Boolean).join(" ");
    return doc.name;
  };
  const refsStore = {
    query: async (model, path, _kind, id) =>
      Object.values(db[model])
        .filter((doc) => valuesAt(doc, path).map(String).includes(String(id)))
        .map((doc) => ({ _id: doc._id, deletedAt: doc.deletedAt })),
  };
  const mark = (op, model, id, extra = {}) => state.writes.push({ op, model, id: String(id), ...extra });
  // Счётчик записей переноса: crashAt — номер записи, которая упадёт
  const tick = () => {
    state.calls += 1;
    if (state.crashAt === state.calls) {
      state.crashAt = null;
      throw new Error("сбой связи с базой");
    }
  };
  const blankValue = (v) => [null, undefined, "", "[]"].includes(v);
  state.store = {
    get: async (model, id) => (db[model][String(id)] ? structuredClone(db[model][String(id)]) : null),
    describe: async (model, id) => {
      const doc = db[model][String(id)];
      return doc ? { name: nameOf(model, doc), hidden: hidden(doc), updatedAt: doc.updatedAt } : null;
    },
    configurations: async (modelId) =>
      Object.values(db.DeviceConfiguration)
        .filter((c) => String(c.deviceModelId) === String(modelId))
        .map((c) => structuredClone(c)),
    rewire: async ({ model, path, kind, ids, source, target, self, unique }) => {
      state.rewires.push({ model, path, ids: [...ids] });
      tick();
      let n = 0;
      for (const id of ids) {
        const doc = db[model][id];
        if (!doc) continue;
        let changed = false;
        if (kind === "single") {
          if (String(doc[path]) === source) {
            doc[path] = target;
            changed = true;
          }
        } else if (kind === "subdoc") {
          const at = path.lastIndexOf(".");
          const field = path.slice(at + 1);
          const list = getAt(doc, path.slice(0, at)) ?? [];
          // unique: элемент источника, у которого уже есть пара с целью, снимается
          if (unique) {
            const keyOf = (el) => unique.map((f) => String(el[f] ?? null)).join("|");
            const have = new Set(list.filter((el) => String(el[field]) === target).map(keyOf));
            for (let i = list.length - 1; i >= 0; i -= 1) {
              if (String(list[i][field]) === source && have.has(keyOf(list[i]))) {
                list.splice(i, 1);
                changed = true;
              }
            }
          }
          for (const el of list) {
            if (String(el[field]) === source) {
              el[field] = target;
              changed = true;
            }
          }
        } else {
          const list = (getAt(doc, path) ?? []).map(String);
          if (list.includes(source)) {
            doc[path] =
              list.includes(target) || self === id ? list.filter((v) => v !== source) : list.map((v) => (v === source ? target : v));
            changed = true;
          }
        }
        if (changed) {
          n += 1;
          mark("rewire", model, id, { path });
        }
      }
      return n;
    },
    updateTarget: async (model, id, { addToSet = {}, set = {} }, userId) => {
      const doc = db[model][id];
      for (const [path, list] of Object.entries(addToSet)) {
        const have = (doc[path] ?? []).map(String);
        doc[path] = [...have, ...list.filter((v) => !have.includes(String(v)))];
      }
      Object.assign(doc, set, { updatedBy: userId });
      mark("target", model, id, { addToSet, set });
      return true;
    },
    fillValues: async (configId, values, userId) => {
      const doc = db.DeviceConfiguration[configId];
      if (!doc || (doc.values ?? []).some((v) => !["", "[]", null, undefined].includes(v.value))) return false;
      Object.assign(doc, { values: structuredClone(values), updatedBy: userId });
      mark("fill", "DeviceConfiguration", configId);
      return true;
    },
    retireMany: async (model, ids, { userId, now }) => {
      let n = 0;
      for (const id of ids) {
        const doc = db[model][id];
        if (!doc || doc.deletedAt) continue;
        Object.assign(doc, { deletedAt: now, deletedBy: userId });
        mark("retireMany", model, id);
        n += 1;
      }
      return n;
    },
    configs: async (ids) =>
      ids.map((id) => db.DeviceConfiguration[String(id)]).filter(Boolean).map((c) => structuredClone(c)),
    links: async (field, id) =>
      Object.values(db.DeviceTypeAttribute)
        .filter((l) => String(l[field]) === String(id))
        .map((l) => ({ _id: l._id, deviceTypeId: l.deviceTypeId, attributeId: l.attributeId })),
    dropLinks: async ({ ids, field, source }) => {
      tick();
      let n = 0;
      for (const id of ids) {
        const doc = db.DeviceTypeAttribute[id];
        if (!doc || String(doc[field]) !== source) continue;
        delete db.DeviceTypeAttribute[id];
        mark("dropLink", "DeviceTypeAttribute", id);
        n += 1;
      }
      return n;
    },
    addOptions: async (id, options, userId) => {
      tick();
      const doc = db.DeviceAttribute[id];
      const fresh = options.filter((o) => !(doc.options ?? []).some((x) => x.value === o.value));
      if (!fresh.length) return 0;
      doc.options = [...(doc.options ?? []), ...structuredClone(fresh)];
      doc.updatedBy = userId;
      mark("options", "DeviceAttribute", id);
      return fresh.length;
    },
    dropValues: async ({ ids, source }) => {
      tick();
      let n = 0;
      for (const id of ids) {
        const doc = db.DeviceConfiguration[id];
        if (!doc?.values?.some((v) => String(v.attributeId) === source)) continue;
        doc.values = doc.values.filter((v) => String(v.attributeId) !== source);
        mark("dropValue", "DeviceConfiguration", id);
        n += 1;
      }
      return n;
    },
    moveValues: async ({ ids, source, target, from, to }) => {
      tick();
      let n = 0;
      for (const id of ids) {
        const doc = db.DeviceConfiguration[id];
        const el = doc?.values?.find((v) => String(v.attributeId) === source && v.value === from);
        if (!el || doc.values.some((v) => String(v.attributeId) === target && !blankValue(v.value))) continue;
        doc.values = doc.values.filter((v) => !(String(v.attributeId) === target && blankValue(v.value)));
        Object.assign(el, { attributeId: target, value: to });
        mark("moveValue", "DeviceConfiguration", id);
        n += 1;
      }
      return n;
    },
    retire: async (model, id, { mode, name, set = {}, userId, now }) => {
      if (name !== undefined && state.nameTaken === name) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      const doc = db[model][id];
      if (mode === "delete") {
        if (Object.values(db.DeviceTypeAttribute).some((l) => String(l.groupId) === id)) return false;
        if (doc) {
          delete db[model][id];
          mark("delete", model, id);
        }
        return true;
      }
      if (!doc || hidden(doc)) return true;
      const named = name === undefined ? {} : { name };
      Object.assign(doc, mode === "deleted" ? { ...named, deletedAt: now, deletedBy: userId } : { ...named, isActive: false }, set, {
        updatedBy: userId,
      });
      mark("retire", model, id);
      return true;
    },
  };
  state.merge = createCatalogMerge({ refs: createCatalogRefs({ store: refsStore }), store: state.store, now: () => NOW });
  return state;
};

const writesOf = (state, model, id) => state.writes.filter((w) => w.model === model && w.id === id);

test("mergeModels: переносит устройства, конфигурации, сборки, совместимость по списку", async () => {
  const w = world();
  const planned = await w.merge.plan("DeviceModel", SRC, TGT);
  assert.equal(planned.ok, true, planned.error);
  assert.deepEqual(planned.conflicts, []);
  assert.deepEqual(planned.lines, [
    "устройств: 2 и 1 удалённое",
    "конфигураций: 1 и 1 удалённое",
    "сборок: 1",
    "совместимость: у 3 моделей",
  ]);
  assert.deepEqual(planned.deviceLabels, ["Ноутбук NB-000101", "Ноутбук NB-000102"]);
  assert.deepEqual(planned.devices, [
    { id: D1, label: "Ноутбук NB-000101" },
    { id: D2, label: "Ноутбук NB-000102" },
  ]);
  assert.equal(planned.moreDevices, 0);
  assert.equal(planned.multiOn, false);
  assert.equal(planned.newName, "T14 G4 (слито в «T14 Gen 4»)");
  // Снимок: сущность, обе записи и ссылки источника по путям
  const snap = planned.refs;
  assert.equal(snap.entity, "DeviceModel");
  assert.equal(snap.source, SRC);
  assert.equal(snap.target, TGT);
  assert.deepEqual(
    snap.refs.map((r) => [`${r.model}:${r.path}`, r.ids]),
    [
      ["ClientDevice:deviceModelId", [D1, D2, D3]],
      ["DeviceConfiguration:deviceModelId", [C1, C2]],
      ["DeviceBuild:parts.deviceModelId", [B1]],
      ["DeviceModel:compatibleWithModelIds", [TGT, OTHER1, OTHER2].sort()],
    ],
  );
  assert.deepEqual(w.writes, [], "план ничего не пишет");

  const applied = await w.merge.apply("DeviceModel", snap, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(applied.moved, { устройств: 3, конфигураций: 2, сборок: 1, совместимость: 3 });
  const { db } = w;
  // Устройства (и удалённое) и конфигурации — у цели, конфигурации устройств прежние
  for (const id of [D1, D2, D3]) assert.equal(db.ClientDevice[id].deviceModelId, TGT);
  assert.equal(db.ClientDevice[D1].configurationId, C1);
  assert.equal(db.DeviceConfiguration[C1].deviceModelId, TGT);
  assert.equal(db.DeviceConfiguration[C2].deviceModelId, TGT);
  assert.deepEqual(db.DeviceBuild[B1].parts.map((p) => p.deviceModelId), [TGT, OTHER1]);
  // Совместимость: source → target без дублей; у цели — объединение без неё самой
  assert.deepEqual(db.DeviceModel[OTHER1].compatibleWithModelIds, [TGT]);
  assert.deepEqual(db.DeviceModel[OTHER2].compatibleWithModelIds, [TGT]);
  assert.deepEqual(db.DeviceModel[TGT].compatibleWithModelIds, [OTHER1]);
  // Вендор цели остаётся
  assert.equal(db.DeviceModel[TGT].vendorId, VB);
  // Только id снимка; чужое устройство цели не тронуто
  for (const call of w.rewires) {
    const entry = snap.refs.find((r) => r.model === call.model && r.path === call.path);
    assert.ok(call.ids.every((id) => entry.ids.includes(id)), `${call.model}:${call.path}`);
  }
  assert.deepEqual(writesOf(w, "ClientDevice", D4), []);
  // Источник гасится последним
  assert.equal(w.writes.at(-1).op, "retire");
  assert.equal(db.DeviceModel[SRC].deletedAt, NOW);
  assert.equal(db.DeviceModel[SRC].deletedBy, USER);
});

test("mergeModels: разные типы — отказ", async () => {
  const w = world();
  const planned = await w.merge.plan("DeviceModel", MONO, TGT);
  assert.equal(planned.ok, false);
  assert.equal(planned.error, "Модели разных типов: «Моноблок» и «Ноутбук» — устройства сменили бы тип");
});

test("merge: цель скрыта / та же запись — отказ", async () => {
  const w = world();
  const deleted = await w.merge.plan("DeviceModel", SRC, DEAD);
  assert.equal(deleted.ok, false);
  assert.equal(deleted.error, "Сливать в скрытую запись нельзя: модель «Lenovo Old» скрыта");
  const hidden = await w.merge.plan("Vendor", VA, V_HIDDEN);
  assert.equal(hidden.error, "Сливать в скрытую запись нельзя: вендор «Старый» скрыт");
  const hiddenSource = await w.merge.plan("Vendor", V_HIDDEN, VA);
  assert.equal(hiddenSource.error, "Слить можно только живую запись: вендор «Старый» скрыт");
  const self = await w.merge.plan("DeviceModel", SRC, SRC);
  assert.equal(self.ok, false);
  assert.equal(self.error, "Нельзя слить запись саму в себя");
  assert.deepEqual(w.writes, []);
});

test("merge: при утверждении новое устройство — дрейф, ничего не перенесено", async () => {
  const w = world();
  const planned = await w.merge.plan("DeviceModel", SRC, TGT);
  w.db.ClientDevice[D5] = { _id: D5, label: "Ноутбук NB-000105", deviceModelId: SRC };
  const drift = "изменилось после предложения: на модель «Lenovo T14 G4» появилось 1 новое устройство";
  assert.equal(await w.merge.drift("DeviceModel", planned.refs), drift);
  const applied = await w.merge.apply("DeviceModel", planned.refs, { userId: USER });
  assert.equal(applied.ok, false);
  assert.equal(applied.error, drift);
  assert.deepEqual(w.writes, []);
  assert.equal(w.db.DeviceModel[SRC].deletedAt, undefined);
  // Пропавшая ссылка (не к цели) — тоже дрейф
  const again = world();
  const snap = (await again.merge.plan("DeviceModel", SRC, TGT)).refs;
  again.db.DeviceBuild[B1].parts[0].deviceModelId = OTHER2;
  assert.equal(
    await again.merge.drift("DeviceModel", snap),
    "изменилось после предложения: на модель «Lenovo T14 G4» стало меньше: 1 сборка",
  );
  // Нет снимка — отказ, без записи
  const none = await again.merge.apply("DeviceModel", null, { userId: USER });
  assert.equal(none.ok, false);
  assert.match(none.error, /^изменилось после предложения: нет снимка/);
});

test("merge: повтор после сбоя — ничего не переносится дважды", async () => {
  const w = world();
  const snap = (await w.merge.plan("DeviceModel", SRC, TGT)).refs;
  // Сбой на втором переносе: устройства уже у цели, конфигурации — ещё нет
  w.crashAt = 2;
  const crashed = await w.merge.apply("DeviceModel", snap, { userId: USER });
  assert.equal(crashed.ok, false);
  assert.equal(w.db.ClientDevice[D1].deviceModelId, TGT);
  assert.equal(w.db.DeviceConfiguration[C1].deviceModelId, SRC);
  assert.equal(w.db.DeviceModel[SRC].deletedAt, undefined, "источник не гасится до конца переноса");

  // Повтор того же снимка: уже перенесённое — не дрейф, дописывается остаток
  assert.equal(await w.merge.drift("DeviceModel", snap), null);
  const repeat = await w.merge.apply("DeviceModel", snap, { userId: USER });
  assert.equal(repeat.ok, true, repeat.error);
  assert.deepEqual(repeat.moved, { конфигураций: 2, сборок: 1, совместимость: 3 });
  assert.equal(w.db.DeviceModel[SRC].deletedAt, NOW);
  assert.equal(w.db.DeviceModel[SRC].name, "T14 G4 (слито в «T14 Gen 4»)");

  // Третий раз: ничего не пишется, имя не дописывается дважды
  const before = w.writes.length;
  const third = await w.merge.apply("DeviceModel", snap, { userId: USER });
  assert.equal(third.ok, true, third.error);
  assert.deepEqual(third.moved, {});
  assert.equal(w.writes.length, before);
  assert.equal(w.db.DeviceModel[SRC].name, "T14 G4 (слито в «T14 Gen 4»)");
  // Каждый документ переписан ровно один раз
  for (const [model, id] of [
    ["ClientDevice", D1],
    ["ClientDevice", D3],
    ["DeviceConfiguration", C1],
    ["DeviceBuild", B1],
    ["DeviceModel", OTHER2],
  ]) {
    assert.equal(writesOf(w, model, id).filter((x) => x.op === "rewire").length, 1, `${model}:${id}`);
  }
  assert.deepEqual(w.db.DeviceModel[TGT].compatibleWithModelIds, [OTHER1]);
});

test("merge: источник переименован «(слито в «B»)» и скрыт", async () => {
  const w = world();
  const planned = await w.merge.plan("Vendor", VA, VB);
  assert.equal(planned.ok, true, planned.error);
  assert.deepEqual(planned.lines, ["моделей: 4 и 1 удалённое"]);
  assert.equal(planned.newName, "Lenovo (слито в «Lenovo Group»)");
  const applied = await w.merge.apply("Vendor", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(applied.moved, { моделей: 5 });
  const v = w.db.Vendor[VA];
  assert.equal(v.name, "Lenovo (слито в «Lenovo Group»)");
  assert.equal(v.isActive, false);
  assert.equal(v.updatedBy, USER);
  assert.equal(v.deletedAt, undefined, "у вендора — isActive:false, не deletedAt");
  assert.equal(w.db.DeviceModel[DEAD].vendorId, VB, "удалённая модель тоже переведена");
  // Поставщик: устройства на цель, источник скрыт
  const s = await w.merge.plan("Supplier", S1, S2);
  assert.deepEqual(s.lines, ["устройств: 3"]);
  assert.deepEqual(s.deviceLabels, ["Ноутбук NB-000101", "Ноутбук NB-000102", "Ноутбук NB-000104"]);
  assert.equal((await w.merge.apply("Supplier", s.refs, { userId: USER })).ok, true);
  assert.equal(w.db.Supplier[S1].name, "Ситилинк (слито в «Citilink»)");
  assert.equal(w.db.Supplier[S1].isActive, false);
  assert.equal(w.db.ClientDevice[D4].supplierId, S2);
});

test("mergeGroups: связи в цель, источник удалён", async () => {
  const w = world();
  const planned = await w.merge.plan("AttributeGroup", G1, G2);
  assert.equal(planned.ok, true, planned.error);
  assert.deepEqual(planned.lines, ["связей: 2"]);
  assert.deepEqual(planned.deviceLabels, []);
  const applied = await w.merge.apply("AttributeGroup", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(applied.moved, { связей: 2 });
  assert.equal(w.db.DeviceTypeAttribute[L1].groupId, G2);
  assert.equal(w.db.DeviceTypeAttribute[L2].groupId, G2);
  assert.equal(w.db.AttributeGroup[G1], undefined);
  assert.equal(w.writes.at(-1).op, "delete");
});

test("mergeModels: пустая конфигурация источника скрыта, не перенесена", async () => {
  const w = world();
  w.db.DeviceConfiguration[C_EMPTY] = { _id: C_EMPTY, name: "", deviceModelId: SRC, values: [], updatedAt: OLD };
  const planned = await w.merge.plan("DeviceModel", SRC, TGT);
  assert.equal(planned.ok, true, planned.error);
  // В счёт идут только переезжающие конфигурации; пустая — цель сверки
  assert.equal(planned.lines[1], "конфигураций: 1 и 1 удалённое");
  assert.deepEqual(planned.refs.retire, [C_EMPTY]);
  assert.deepEqual(planned.targets, [{ model: "DeviceConfiguration", id: C_EMPTY, updatedAt: OLD }]);
  const applied = await w.merge.apply("DeviceModel", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(applied.moved.конфигураций, 2);
  const empty = w.db.DeviceConfiguration[C_EMPTY];
  assert.equal(empty.deviceModelId, SRC);
  assert.equal(empty.deletedAt, NOW);
  assert.equal(empty.deletedBy, USER);
  assert.ok(!w.rewires.some((call) => call.ids.includes(C_EMPTY)));
  // Пустая конфигурация получила значение до утверждения — дрейф
  const again = world();
  again.db.DeviceConfiguration[C_EMPTY] = { _id: C_EMPTY, name: "базовая", deviceModelId: SRC, values: [] };
  const snap = (await again.merge.plan("DeviceModel", SRC, TGT)).refs;
  again.db.DeviceConfiguration[C_EMPTY].values.push({ attributeId: "x", value: "4" });
  assert.equal(
    await again.merge.drift("DeviceModel", snap),
    "изменилось после предложения: конфигурация «базовая» уже не пустая",
  );
});

test("mergeModels: у цели одна конфигурация — включится «Несколько конфигураций»", async () => {
  const w = world();
  w.db.DeviceModel[TGT].multiConfig = false;
  const planned = await w.merge.plan("DeviceModel", SRC, TGT);
  assert.equal(planned.multiOn, true);
  assert.equal(planned.refs.multiOn, true);
  const applied = await w.merge.apply("DeviceModel", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(w.db.DeviceModel[TGT].multiConfig, true);
  // Конфигурация источника пустая и без ссылок: у цели остаётся одна — режим не меняется
  const one = world();
  one.db.DeviceModel[TGT].multiConfig = false;
  one.db.DeviceConfiguration[C1].values = [];
  for (const id of [D1, D2]) one.db.ClientDevice[id].configurationId = null;
  delete one.db.DeviceConfiguration[C2];
  delete one.db.ClientDevice[D3];
  const quiet = await one.merge.plan("DeviceModel", SRC, TGT);
  assert.equal(quiet.multiOn, false);
  assert.deepEqual(quiet.refs.retire, [C1]);
  // Цель получила ещё одну конфигурацию до утверждения — дрейф
  const drifted = world();
  drifted.db.DeviceModel[TGT].multiConfig = false;
  drifted.db.DeviceConfiguration[C3].deviceModelId = OTHER1;
  const snap = (await drifted.merge.plan("DeviceModel", SRC, TGT)).refs;
  assert.equal(snap.multiOn, false);
  drifted.db.DeviceConfiguration[C3].deviceModelId = TGT;
  assert.equal(
    await drifted.merge.drift("DeviceModel", snap),
    "изменилось после предложения: у модели «Lenovo Group T14 Gen 4» изменился состав конфигураций",
  );
});

// Две модели с одной конфигурацией, цель не в режиме нескольких (R5b)
const singlePair = (sourceValues, targetValues) => {
  const w = world();
  w.db.DeviceModel[TGT].multiConfig = false;
  delete w.db.DeviceConfiguration[C2];
  w.db.ClientDevice[D3].configurationId = C1;
  w.db.DeviceConfiguration[C1].values = sourceValues;
  w.db.DeviceConfiguration[C3].values = targetValues;
  w.db.DeviceBuild[B1].parts[0].configurationId = C1;
  return w;
};

test("mergeModels: одинаковые конфигурации — сливаются, режим не меняется", async () => {
  const same = [
    { attributeId: "x", value: "16" },
    { attributeId: "m", value: '["a","b"]' },
    { attributeId: "e", value: "" },
  ];
  const w = singlePair(same, [
    { attributeId: "m", value: '["b","a"]' },
    { attributeId: "x", value: "16" },
  ]);
  const planned = await w.merge.plan("DeviceModel", SRC, TGT);
  assert.equal(planned.ok, true, planned.error);
  assert.equal(planned.multiOn, false);
  assert.deepEqual(planned.collapse, { from: "16/512", into: "32/1T" });
  const { collapse } = planned.refs;
  assert.equal(collapse.source, C1);
  assert.equal(collapse.target, C3);
  assert.deepEqual(
    collapse.refs.map((r) => [`${r.model}:${r.path}`, r.ids]),
    [
      ["ClientDevice:configurationId", [D1, D2, D3]],
      ["DeviceBuild:parts.configurationId", [B1]],
    ],
  );
  // Слитая конфигурация не переезжает и не считается; обе — цели сверки
  assert.ok(!planned.lines.some((line) => line.startsWith("конфигураций")));
  assert.deepEqual(
    planned.targets.map((t) => t.id),
    [C1, C3],
  );

  const applied = await w.merge.apply("DeviceModel", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(applied.moved, {
    устройств: 3,
    сборок: 1,
    совместимость: 3,
    "устройств в конфигурацию цели": 3,
    "сборок в конфигурацию цели": 1,
  });
  const { db } = w;
  for (const id of [D1, D2, D3]) {
    assert.equal(db.ClientDevice[id].deviceModelId, TGT);
    assert.equal(db.ClientDevice[id].configurationId, C3);
  }
  assert.deepEqual(db.DeviceBuild[B1].parts[0], { deviceModelId: TGT, configurationId: C3 });
  assert.equal(db.DeviceConfiguration[C1].deviceModelId, SRC);
  assert.equal(db.DeviceConfiguration[C1].deletedAt, NOW);
  assert.equal(db.DeviceModel[TGT].multiConfig, false);
  for (const call of w.rewires.filter((c) => c.model === "ClientDevice" && c.path === "configurationId")) {
    assert.ok(call.ids.every((id) => [D1, D2, D3].includes(id)));
  }
  // Повтор: ничего не пишется
  const before = w.writes.length;
  assert.equal((await w.merge.apply("DeviceModel", planned.refs, { userId: USER })).ok, true);
  assert.equal(w.writes.length, before);

  // До утверждения характеристики цели изменились — дрейф, ничего не перенесено
  const drifted = singlePair(same, [{ attributeId: "x", value: "16" }, { attributeId: "m", value: '["a","b"]' }]);
  const snap = (await drifted.merge.plan("DeviceModel", SRC, TGT)).refs;
  drifted.db.DeviceConfiguration[C3].values[0].value = "32";
  assert.equal(
    await drifted.merge.drift("DeviceModel", snap),
    "изменилось после предложения: конфигурации «16/512» и «32/1T» уже различаются",
  );
  // Новое устройство на сливаемой конфигурации — тоже дрейф
  const moreDevices = singlePair(same, same);
  const snap2 = (await moreDevices.merge.plan("DeviceModel", SRC, TGT)).refs;
  moreDevices.db.ClientDevice[D5] = { _id: D5, label: "Ноутбук NB-000105", deviceModelId: OTHER1, configurationId: C1 };
  assert.equal(
    await moreDevices.merge.drift("DeviceModel", snap2),
    "изменилось после предложения: на конфигурацию «16/512» появилось 1 новое устройство",
  );
  assert.equal((await moreDevices.merge.apply("DeviceModel", snap2, { userId: USER })).ok, false);
  assert.deepEqual(moreDevices.writes, []);
});

test("mergeModels: разные характеристики — включится «Несколько конфигураций»", async () => {
  const w = singlePair([{ attributeId: "x", value: "16" }], [{ attributeId: "x", value: "32" }]);
  const planned = await w.merge.plan("DeviceModel", SRC, TGT);
  assert.equal(planned.collapse, null);
  assert.equal(planned.refs.collapse, undefined);
  assert.equal(planned.multiOn, true);
  assert.equal(planned.lines[1], "конфигураций: 1");
  const applied = await w.merge.apply("DeviceModel", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(w.db.DeviceConfiguration[C1].deviceModelId, TGT);
  assert.equal(w.db.DeviceConfiguration[C1].deletedAt, undefined);
  assert.equal(w.db.ClientDevice[D1].configurationId, C1);
  assert.equal(w.db.DeviceModel[TGT].multiConfig, true);
  // Лишний атрибут у источника — тоже разные
  const extra = singlePair(
    [
      { attributeId: "x", value: "16" },
      { attributeId: "y", value: "DDR5" },
    ],
    [{ attributeId: "x", value: "16" }],
  );
  assert.equal((await extra.merge.plan("DeviceModel", SRC, TGT)).multiOn, true);
});

test("mergeModels: сбой на третьем переносе — у цели с двумя конфигурациями уже «Несколько конфигураций»", async () => {
  const w = singlePair([{ attributeId: "x", value: "16" }], [{ attributeId: "x", value: "32" }]);
  const snap = (await w.merge.plan("DeviceModel", SRC, TGT)).refs;
  assert.equal(snap.multiOn, true);
  // Переносы: устройства (1), конфигурации (2), сборки (3 — сбой)
  w.crashAt = 3;
  const crashed = await w.merge.apply("DeviceModel", snap, { userId: USER });
  assert.equal(crashed.ok, false);
  assert.deepEqual(crashed.moved, { устройств: 3, конфигураций: 1 });
  const live = Object.values(w.db.DeviceConfiguration).filter((c) => c.deviceModelId === TGT && !c.deletedAt);
  assert.equal(live.length, 2);
  assert.equal(w.db.DeviceModel[TGT].multiConfig, true, "вне режима нескольких — не больше одной конфигурации");
  // Повтор доносит остаток, режим не пишется второй раз
  const repeat = await w.merge.apply("DeviceModel", snap, { userId: USER });
  assert.equal(repeat.ok, true, repeat.error);
  assert.equal(w.writes.filter((x) => x.op === "target" && x.set?.multiConfig).length, 1);
});

test("mergeModels: у цели пустая конфигурация — получает значения источника", async () => {
  const values = [
    { attributeId: "x", value: "16" },
    { attributeId: "m", value: '["a","b"]' },
  ];
  const w = singlePair(values, [{ attributeId: "x", value: "" }]);
  const planned = await w.merge.plan("DeviceModel", SRC, TGT);
  assert.equal(planned.ok, true, planned.error);
  assert.equal(planned.multiOn, false);
  assert.equal(planned.refs.collapse.fill, true);
  assert.deepEqual(planned.collapse, { from: "16/512", into: "32/1T" });
  const applied = await w.merge.apply("DeviceModel", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  const { db } = w;
  assert.deepEqual(db.DeviceConfiguration[C3].values, values);
  // Значения — до переноса ссылок
  assert.ok(w.writes.findIndex((x) => x.op === "fill") < w.writes.findIndex((x) => x.op === "rewire"));
  assert.equal(db.ClientDevice[D1].configurationId, C3);
  assert.equal(db.DeviceConfiguration[C1].deletedAt, NOW);
  assert.equal(db.DeviceModel[TGT].multiConfig, false);
  // Повтор: цель уже со значениями источника — не дрейф и без записи
  assert.equal(await w.merge.drift("DeviceModel", planned.refs), null);
  const before = w.writes.length;
  assert.equal((await w.merge.apply("DeviceModel", planned.refs, { userId: USER })).ok, true);
  assert.equal(w.writes.length, before);
  // У цели появились свои значения после предложения — дрейф, ничего не записано
  const drifted = singlePair(values, []);
  const snap = (await drifted.merge.plan("DeviceModel", SRC, TGT)).refs;
  drifted.db.DeviceConfiguration[C3].values = [{ attributeId: "x", value: "32" }];
  assert.equal(
    await drifted.merge.drift("DeviceModel", snap),
    "изменилось после предложения: у конфигурации «32/1T» появились значения",
  );
  assert.equal((await drifted.merge.apply("DeviceModel", snap, { userId: USER })).ok, false);
  assert.deepEqual(drifted.writes, []);
});

test("merge: безымянная модель — новое имя без «undefined»; имя занято — ссылки перенесены, понятный отказ с moved", async () => {
  const w = world();
  delete w.db.DeviceModel[SRC].name;
  const planned = await w.merge.plan("DeviceModel", SRC, TGT);
  assert.equal(planned.newName, "Lenovo (слито в «T14 Gen 4»)");
  const applied = await w.merge.apply("DeviceModel", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(w.db.DeviceModel[SRC].name, "Lenovo (слито в «T14 Gen 4»)");

  const taken = world();
  taken.nameTaken = "Lenovo (слито в «Lenovo Group»)";
  const snap = (await taken.merge.plan("Vendor", VA, VB)).refs;
  const failed = await taken.merge.apply("Vendor", snap, { userId: USER });
  assert.equal(failed.ok, false);
  assert.equal(
    failed.error,
    "ссылки перенесены, но «Lenovo» не скрыт: имя «Lenovo (слито в «Lenovo Group»)» уже занято — " +
      "переименуйте запись с этим именем и повторите слияние",
  );
  assert.deepEqual(failed.moved, { моделей: 5 });
  assert.equal(taken.db.Vendor[VA].isActive, true);
});

// ─── Атрибуты, конфигурации, типы ────────────────────────────────────────────

const ATTR_SRC = oid("7", 1);
const ATTR_TGT = oid("7", 2);
const ATTR_MS = oid("7", 3);
const ATTR_MT = oid("7", 4);
const ATTR_STR = oid("7", 5);
const ASM = oid("6", 1);
const LA1 = oid("1", 1);
const LA2 = oid("1", 2);
const LA3 = oid("1", 3);
const CA1 = oid("2", 1);
const CA2 = oid("2", 2);
const CA3 = oid("2", 3);
const CA4 = oid("2", 4);
const opts = (...values) => values.map((value) => ({ value, label: value }));

// Атрибуты: ОЗУ (число) — дубль «Объём ОЗУ»; цвет (multiselect) — дубль «Цвет корпуса».
// Связи: у TYPE1 есть оба атрибута ОЗУ, у TYPE2 — только источник; ASM — ключевая
// характеристика по источнику. Конфигурации: CA1 — те же значения, CA2 — только
// источник, CA3 — пустое у источника, CA4 — удалённая с разными значениями
const attrWorld = () => {
  const w = world();
  const { db } = w;
  const attr = (id, code, name, valueType, options = []) => ({ _id: id, code, name, valueType, options, isActive: true, updatedAt: OLD });
  Object.assign(db.DeviceAttribute, {
    [ATTR_SRC]: attr(ATTR_SRC, "ram_old", "ОЗУ, ГБ", "number"),
    [ATTR_TGT]: attr(ATTR_TGT, "ram_gb", "Объём ОЗУ", "number"),
    [ATTR_MS]: attr(ATTR_MS, "color_old", "Цвет", "multiselect", opts("чёрный", "серый", "синий", "black")),
    [ATTR_MT]: attr(ATTR_MT, "color", "Цвет корпуса", "multiselect", opts("black", "grey")),
    [ATTR_STR]: attr(ATTR_STR, "note", "Заметка", "string"),
  });
  Object.assign(db.DeviceTypeAttribute, {
    [LA1]: { _id: LA1, deviceTypeId: TYPE1, attributeId: ATTR_SRC, required: true },
    [LA2]: { _id: LA2, deviceTypeId: TYPE1, attributeId: ATTR_TGT },
    [LA3]: { _id: LA3, deviceTypeId: TYPE2, attributeId: ATTR_SRC },
  });
  db.DeviceType[ASM] = {
    _id: ASM,
    name: "Своя сборка",
    assembly: { enabled: true, slots: [], keySpecs: [{ typeId: TYPE2, source: "attribute", attributeId: ATTR_SRC, aggregate: "sum" }] },
  };
  const v = (attributeId, value) => ({ attributeId, value });
  Object.assign(db.DeviceConfiguration, {
    [CA1]: { _id: CA1, name: "16/512", deviceModelId: SRC, values: [v(ATTR_SRC, "16"), v(ATTR_TGT, "16")] },
    [CA2]: { _id: CA2, name: "8/256", deviceModelId: TGT, values: [v(ATTR_SRC, "8")] },
    [CA3]: { _id: CA3, name: "", deviceModelId: OTHER1, values: [v(ATTR_SRC, ""), v(ATTR_TGT, "4")] },
    [CA4]: { _id: CA4, name: "старая", deviceModelId: OTHER2, values: [v(ATTR_SRC, "2"), v(ATTR_TGT, "1")], deletedAt: OLD },
  });
  return w;
};

test("mergeAttributes: конфликт значений — отказ со списком конфигураций", async () => {
  const w = attrWorld();
  w.db.DeviceConfiguration[CA1].values[1].value = "32";
  w.db.DeviceConfiguration[CA2].values.push({ attributeId: ATTR_TGT, value: "32" });
  const planned = await w.merge.plan("DeviceAttribute", ATTR_SRC, ATTR_TGT);
  assert.equal(planned.ok, false);
  assert.equal(planned.status, 409);
  // Удалённая CA4 с разными значениями не мешает: её значение остаётся у источника
  assert.equal(
    planned.error,
    [
      "слить атрибут «ОЗУ, ГБ» в «Объём ОЗУ» нельзя — в 2 конфигурациях разные значения:",
      "   – Lenovo T14 G4 «16/512»: 16 и 32",
      "   – Lenovo Group T14 Gen 4 «8/256»: 8 и 32",
      "Сначала поправьте эти конфигурации отдельным предложением.",
    ].join("\n"),
  );
  assert.deepEqual(w.writes, []);
  // Разный вид значений — отказ
  const kinds = await w.merge.plan("DeviceAttribute", ATTR_SRC, ATTR_STR);
  assert.equal(kinds.ok, false);
  assert.equal(kinds.error, "Атрибуты с разным видом значений: «ОЗУ, ГБ» — число, «Заметка» — строка");
  // Новый конфликт после предложения — дрейф
  const again = attrWorld();
  const snap = (await again.merge.plan("DeviceAttribute", ATTR_SRC, ATTR_TGT)).refs;
  again.db.DeviceConfiguration[CA2].values.push({ attributeId: ATTR_TGT, value: "32" });
  assert.equal(
    await again.merge.drift("DeviceAttribute", snap),
    "изменилось после предложения: значения «ОЗУ, ГБ» и «Объём ОЗУ» изменились в 1 конфигурации",
  );
  assert.equal((await again.merge.apply("DeviceAttribute", snap, { userId: USER })).ok, false);
  assert.deepEqual(again.writes, []);
});

test("mergeAttributes: одинаковые значения — значение источника убрано", async () => {
  const w = attrWorld();
  const planned = await w.merge.plan("DeviceAttribute", ATTR_SRC, ATTR_TGT);
  assert.equal(planned.ok, true, planned.error);
  // Удалённая CA4 с разными значениями не переезжает и не считается
  assert.deepEqual(planned.lines, ["связей: 2", "значений: 3", "характеристик: 1"]);
  assert.deepEqual(planned.notes, ["в 2 конфигурациях значение уже есть у «Объём ОЗУ» — значение «ОЗУ, ГБ» уберётся"]);
  assert.deepEqual(planned.refs.values, { drop: [CA1, CA3], move: [{ id: CA2, from: "8", to: "8" }], keep: [CA4] });
  assert.equal(planned.newName, "ОЗУ, ГБ (слито в «Объём ОЗУ»)");
  const applied = await w.merge.apply("DeviceAttribute", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.deepEqual(applied.moved, { связей: 2, значений: 3, характеристик: 1 });
  const { db } = w;
  assert.deepEqual(db.DeviceConfiguration[CA1].values, [{ attributeId: ATTR_TGT, value: "16" }]);
  assert.deepEqual(db.DeviceConfiguration[CA2].values, [{ attributeId: ATTR_TGT, value: "8" }]);
  assert.deepEqual(db.DeviceConfiguration[CA3].values, [{ attributeId: ATTR_TGT, value: "4" }]);
  assert.deepEqual(db.DeviceConfiguration[CA4].values, [
    { attributeId: ATTR_SRC, value: "2" },
    { attributeId: ATTR_TGT, value: "1" },
  ]);
  // Источник скрыт, имя и код освобождены
  const src = db.DeviceAttribute[ATTR_SRC];
  assert.equal(src.isActive, false);
  assert.equal(src.name, "ОЗУ, ГБ (слито в «Объём ОЗУ»)");
  assert.equal(src.code, `ram_old_merged_${ATTR_SRC.slice(-6)}`);
  assert.equal(w.writes.at(-1).op, "retire");
});

test("mergeAttributes: multiselect через optionMap", async () => {
  const w = attrWorld();
  const v = (attributeId, value) => ({ attributeId, value });
  const [M1, M2, M3, M4] = [5, 6, 7, 8].map((n) => oid("2", n));
  Object.assign(w.db.DeviceConfiguration, {
    // только источник: элементы на местах, без пары — как есть
    [M1]: { _id: M1, name: "a", deviceModelId: SRC, values: [v(ATTR_MS, '["чёрный","синий"]')] },
    // после карты то же множество, что у цели: значение источника убрано
    [M2]: { _id: M2, name: "b", deviceModelId: TGT, values: [v(ATTR_MS, '["серый","чёрный"]'), v(ATTR_MT, '["black","grey"]')] },
    // «black» и «чёрный» → один элемент
    [M3]: { _id: M3, name: "c", deviceModelId: OTHER1, values: [v(ATTR_MS, '["black","чёрный"]')] },
    // пустое значение цели уступает место значению источника
    [M4]: { _id: M4, name: "d", deviceModelId: OTHER2, values: [v(ATTR_MS, '["синий"]'), v(ATTR_MT, "")] },
  });
  const optionMap = { чёрный: "black", серый: "grey" };
  const planned = await w.merge.plan("DeviceAttribute", ATTR_MS, ATTR_MT, { optionMap });
  assert.equal(planned.ok, true, planned.error);
  assert.deepEqual(planned.refs.optionMap, optionMap);
  assert.deepEqual(planned.refs.addOptions, [{ value: "синий", label: "синий" }]);
  assert.deepEqual(planned.notes, [
    "варианты: «чёрный» → «black», «серый» → «grey»",
    "к «Цвет корпуса» добавятся варианты: «синий»",
    "в 1 конфигурации значение уже есть у «Цвет корпуса» — значение «Цвет» уберётся",
  ]);
  const applied = await w.merge.apply("DeviceAttribute", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  const { db } = w;
  assert.deepEqual(
    db.DeviceAttribute[ATTR_MT].options.map((o) => o.value),
    ["black", "grey", "синий"],
  );
  assert.deepEqual(db.DeviceConfiguration[M1].values, [v(ATTR_MT, '["black","синий"]')]);
  assert.deepEqual(db.DeviceConfiguration[M2].values, [v(ATTR_MT, '["black","grey"]')]);
  assert.deepEqual(db.DeviceConfiguration[M3].values, [v(ATTR_MT, '["black"]')]);
  assert.deepEqual(db.DeviceConfiguration[M4].values, [v(ATTR_MT, '["синий"]')]);
  // Варианты цели — до переноса значений
  assert.ok(w.writes.findIndex((x) => x.op === "options") < w.writes.findIndex((x) => x.op === "moveValue"));
  // Карта: вариант не того атрибута — отказ; у числа вариантов нет
  const bad = await attrWorld().merge.plan("DeviceAttribute", ATTR_MS, ATTR_MT, { optionMap: { зелёный: "black" } });
  assert.equal(bad.error, "Варианта «зелёный» нет у атрибута «Цвет»");
  const badTarget = await attrWorld().merge.plan("DeviceAttribute", ATTR_MS, ATTR_MT, { optionMap: { чёрный: "white" } });
  assert.equal(badTarget.error, "Варианта «white» нет у атрибута «Цвет корпуса»");
  const plain = await attrWorld().merge.plan("DeviceAttribute", ATTR_SRC, ATTR_TGT, { optionMap: { 16: "16" } });
  assert.equal(plain.error, "У атрибута «ОЗУ, ГБ» нет вариантов");
  // Карта с разными значениями после неё — конфликт
  const clash = attrWorld();
  clash.db.DeviceConfiguration[M2] = { _id: M2, name: "b", deviceModelId: TGT, values: [v(ATTR_MS, '["серый"]'), v(ATTR_MT, '["black"]')] };
  const refused = await clash.merge.plan("DeviceAttribute", ATTR_MS, ATTR_MT, { optionMap });
  // Значение источника — с картой: видно, почему разные
  assert.match(
    refused.error,
    /^слить атрибут «Цвет» в «Цвет корпуса» нельзя — в 1 конфигурации разные значения:\n {3}– Lenovo Group T14 Gen 4 «b»: серый → grey и black\n/,
  );
});

test("mergeAttributes: связь с целью уже есть — связь источника удалена", async () => {
  const w = attrWorld();
  const planned = await w.merge.plan("DeviceAttribute", ATTR_SRC, ATTR_TGT);
  assert.deepEqual(planned.refs.dropLinks, [LA1]);
  const applied = await w.merge.apply("DeviceAttribute", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  const { db } = w;
  assert.equal(db.DeviceTypeAttribute[LA1], undefined, "у TYPE1 уже есть связь с целью");
  assert.equal(db.DeviceTypeAttribute[LA2].attributeId, ATTR_TGT);
  assert.equal(db.DeviceTypeAttribute[LA3].attributeId, ATTR_TGT, "у TYPE2 связь переведена");
  // Удаление — до переноса остальных
  assert.ok(w.writes.findIndex((x) => x.op === "dropLink") < w.writes.findIndex((x) => x.op === "rewire"));
  // У типа появилась связь с целью после предложения — дрейф
  const again = attrWorld();
  const snap = (await again.merge.plan("DeviceAttribute", ATTR_SRC, ATTR_TGT)).refs;
  again.db.DeviceTypeAttribute[oid("1", 9)] = { _id: oid("1", 9), deviceTypeId: TYPE2, attributeId: ATTR_TGT };
  assert.equal(
    await again.merge.drift("DeviceAttribute", snap),
    "изменилось после предложения: у типа «Моноблок» появилась связь с «Объём ОЗУ»",
  );
});

test("mergeAttributes: keySpecs переведены", async () => {
  const w = attrWorld();
  // У второго типа та же характеристика уже по цели — дубль не появляется
  const ASM2 = oid("6", 7);
  const spec = (attributeId) => ({ typeId: TYPE2, source: "attribute", attributeId, aggregate: "sum" });
  w.db.DeviceType[ASM2] = { _id: ASM2, name: "Сервер", assembly: { enabled: true, slots: [], keySpecs: [spec(ATTR_SRC), spec(ATTR_TGT)] } };
  const planned = await w.merge.plan("DeviceAttribute", ATTR_SRC, ATTR_TGT);
  assert.equal(planned.lines.at(-1), "характеристик: 2");
  assert.equal((await w.merge.apply("DeviceAttribute", planned.refs, { userId: USER })).ok, true);
  assert.deepEqual(w.db.DeviceType[ASM].assembly.keySpecs, [spec(ATTR_TGT)]);
  assert.deepEqual(w.db.DeviceType[ASM2].assembly.keySpecs, [spec(ATTR_TGT)]);
});

test("mergeAttributes: повтор после сбоя — ничего не переносится дважды", async () => {
  const w = attrWorld();
  const snap = (await w.merge.plan("DeviceAttribute", ATTR_SRC, ATTR_TGT)).refs;
  // Записи: удаление связи (1), перенос связей (2), характеристик (3), значения: убрать (4 — сбой)
  w.crashAt = 4;
  const crashed = await w.merge.apply("DeviceAttribute", snap, { userId: USER });
  assert.equal(crashed.ok, false);
  assert.deepEqual(crashed.moved, { связей: 2, характеристик: 1 });
  assert.equal(w.db.DeviceAttribute[ATTR_SRC].isActive, true, "источник не гасится до конца переноса");
  assert.equal(await w.merge.drift("DeviceAttribute", snap), null);
  const repeat = await w.merge.apply("DeviceAttribute", snap, { userId: USER });
  assert.equal(repeat.ok, true, repeat.error);
  assert.deepEqual(repeat.moved, { значений: 3 });
  assert.equal(w.db.DeviceAttribute[ATTR_SRC].isActive, false);
  // Третий раз: ничего не пишется, имя и код не дописываются дважды
  const before = w.writes.length;
  const third = await w.merge.apply("DeviceAttribute", snap, { userId: USER });
  assert.equal(third.ok, true, third.error);
  assert.deepEqual(third.moved, {});
  assert.equal(w.writes.length, before);
  assert.equal(w.db.DeviceAttribute[ATTR_SRC].code, `ram_old_merged_${ATTR_SRC.slice(-6)}`);
  for (const id of [CA1, CA2, CA3]) {
    assert.equal(w.writes.filter((x) => x.id === id).length, 1, id);
  }
  assert.equal(w.writes.filter((x) => x.id === LA3).length, 1);
});

// Конфигурации одной модели SRC: CF_S сливается в CF_T
const CF_S = oid("2", 9);
const CF_T = oid("2", 10);
const D6 = oid("a", 6);
const B2 = oid("d", 2);
const configWorld = (sourceValues, targetValues) => {
  const w = attrWorld();
  const { db } = w;
  db.DeviceConfiguration[CF_S] = { _id: CF_S, name: "16/512", deviceModelId: SRC, values: sourceValues, updatedAt: OLD };
  db.DeviceConfiguration[CF_T] = { _id: CF_T, name: "16/512 бис", deviceModelId: SRC, values: targetValues, updatedAt: OLD };
  db.ClientDevice[D6] = { _id: D6, label: "Ноутбук NB-000106", deviceModelId: SRC, configurationId: CF_S };
  db.DeviceBuild[B2] = { _id: B2, name: "Склад", deviceTypeId: TYPE1, parts: [{ deviceModelId: SRC, configurationId: CF_S }] };
  return w;
};

test("mergeConfigurations: другая модель — отказ", async () => {
  const w = configWorld([], []);
  const planned = await w.merge.plan("DeviceConfiguration", CF_S, C3);
  assert.equal(planned.ok, false);
  assert.equal(planned.error, "Конфигурации разных моделей: «Lenovo T14 G4» и «Lenovo Group T14 Gen 4»");
  // Та же модель, значения цели покрывают источник — слияние по ссылкам
  const same = configWorld([{ attributeId: ATTR_TGT, value: "16" }], [{ attributeId: ATTR_TGT, value: "16" }, { attributeId: ATTR_STR, value: "офис" }]);
  const ok = await same.merge.plan("DeviceConfiguration", CF_S, CF_T);
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(ok.lines, ["устройств: 1", "сборок: 1"]);
  const applied = await same.merge.apply("DeviceConfiguration", ok.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(same.db.ClientDevice[D6].configurationId, CF_T);
  assert.equal(same.db.DeviceBuild[B2].parts[0].configurationId, CF_T);
  assert.equal(same.db.DeviceConfiguration[CF_S].deletedAt, NOW);
  assert.equal(same.db.DeviceConfiguration[CF_S].deletedBy, USER);
  assert.equal(same.db.DeviceConfiguration[CF_S].name, "16/512 (слито в «16/512 бис»)");
  assert.deepEqual(same.db.DeviceConfiguration[CF_T].values.length, 2, "значения цели не меняются");
});

test("mergeConfigurations: лишнее значение в источнике — конфликт", async () => {
  const w = configWorld(
    [
      { attributeId: ATTR_TGT, value: "32" },
      { attributeId: ATTR_STR, value: "склад" },
      { attributeId: ATTR_MT, value: "" },
    ],
    [{ attributeId: ATTR_TGT, value: "16" }],
  );
  const planned = await w.merge.plan("DeviceConfiguration", CF_S, CF_T);
  assert.equal(planned.ok, false);
  assert.equal(
    planned.error,
    [
      "слить конфигурацию «16/512» в «16/512 бис» нельзя — значения различаются:",
      "   – Объём ОЗУ: 32 и 16",
      "   – Заметка: склад и не задано",
      "Сначала поправьте конфигурации отдельным предложением.",
    ].join("\n"),
  );
  assert.deepEqual(w.writes, []);
  // Разошлись после предложения — дрейф
  const same = configWorld([{ attributeId: ATTR_TGT, value: "16" }], [{ attributeId: ATTR_TGT, value: "16" }]);
  const snap = (await same.merge.plan("DeviceConfiguration", CF_S, CF_T)).refs;
  same.db.DeviceConfiguration[CF_S].values.push({ attributeId: ATTR_STR, value: "склад" });
  assert.equal(
    await same.merge.drift("DeviceConfiguration", snap),
    "изменилось после предложения: конфигурации «16/512» и «16/512 бис» уже различаются",
  );
});

// Типы: «Мышь» сливается в «Мышь USB»
const TS = oid("6", 2);
const TT = oid("6", 3);
const TO1 = oid("6", 4);
const TO2 = oid("6", 5);
const TASM = oid("6", 6);
const LOC1 = oid("4", 1);
const LOC2 = oid("4", 2);
const LT1 = oid("1", 4);
const LT2 = oid("1", 5);
const LT3 = oid("1", 6);
const MM = oid("b", 7);
const U1 = oid("3", 2);
const U2 = oid("3", 3);
const typeWorld = () => {
  const w = attrWorld();
  const { db } = w;
  const type = (id, name, extra = {}) => ({ _id: id, name, isActive: true, isComponent: false, isPeripheral: true, isConsumable: false, ...extra });
  Object.assign(db.DeviceType, {
    [TS]: type(TS, "Мышь", { attachableToTypeIds: [TYPE2, TT], assembly: { enabled: false, slots: [], keySpecs: [] } }),
    [TT]: type(TT, "Мышь USB", { inventoryPrefix: "МШ", attachableToTypeIds: [TYPE1] }),
    [TO1]: type(TO1, "Док", { attachableToTypeIds: [TS, TT] }),
    [TO2]: type(TO2, "Хаб", { attachableToTypeIds: [TS] }),
    [TASM]: type(TASM, "ПК", {
      isPeripheral: false,
      assembly: {
        enabled: true,
        slots: [
          { typeId: TS, required: false },
          { typeId: TT, required: true },
        ],
        keySpecs: [{ typeId: TS, source: "model", attributeId: null }],
      },
    }),
  });
  db.Location[LOC1] = {
    _id: LOC1,
    name: "Кабинет 1",
    responsibilityRules: { deviceTypeOverrides: [{ deviceType: TS, responsibleUser: U1 }, { deviceType: TT, responsibleUser: U2 }] },
  };
  db.Location[LOC2] = { _id: LOC2, name: "Кабинет 2", responsibilityRules: { deviceTypeOverrides: [{ deviceType: TS, responsibleUser: U1 }] } };
  Object.assign(db.DeviceTypeAttribute, {
    [LT1]: { _id: LT1, deviceTypeId: TS, attributeId: ATTR_STR },
    [LT2]: { _id: LT2, deviceTypeId: TT, attributeId: ATTR_STR },
    [LT3]: { _id: LT3, deviceTypeId: TS, attributeId: ATTR_MT },
  });
  db.DeviceModel[MM] = { _id: MM, name: "M720", vendorId: VA, deviceTypeId: TS, compatibleWithModelIds: [] };
  db.ClientDevice[D6] = { _id: D6, label: "Мышь MS-000001", deviceModelId: MM, deviceTypeId: TS };
  return w;
};

test("mergeDeviceTypes: у источника сборочная схема — отказ «в портале»", async () => {
  const scheme = typeWorld();
  scheme.db.DeviceType[TS].assembly.enabled = true;
  const a = await scheme.merge.plan("DeviceType", TS, TT);
  assert.equal(a.ok, false);
  assert.equal(a.error, "У типа «Мышь» есть сборочная схема — слияние таких типов только в портале");
  // Только слоты (схема выключена) — тоже отказ; только ключевые характеристики — тоже
  const slots = typeWorld();
  slots.db.DeviceType[TS].assembly.slots.push({ typeId: TYPE2, required: false });
  assert.equal((await slots.merge.plan("DeviceType", TS, TT)).error, a.error);
  const keySpecs = typeWorld();
  keySpecs.db.DeviceType[TS].assembly.keySpecs.push({ typeId: TYPE2, source: "model" });
  assert.equal((await keySpecs.merge.plan("DeviceType", TS, TT)).error, a.error);
  const builds = typeWorld();
  builds.db.DeviceBuild[B2] = { _id: B2, name: "Набор", deviceTypeId: TS, parts: [] };
  assert.equal(
    (await builds.merge.plan("DeviceType", TS, TT)).error,
    "У типа «Мышь» есть шаблоны сборки — слияние таких типов только в портале",
  );
  const flags = typeWorld();
  flags.db.DeviceType[TT].isComponent = true;
  flags.db.DeviceType[TT].isPeripheral = false;
  assert.equal((await flags.merge.plan("DeviceType", TS, TT)).error, "У типов «Мышь» и «Мышь USB» разные признаки: комплектующее, периферия");
  for (const w of [scheme, slots, keySpecs, builds, flags]) assert.deepEqual(w.writes, []);
});

test("mergeDeviceTypes: правила помещений и attachableToTypeIds переведены без дублей", async () => {
  const w = typeWorld();
  const planned = await w.merge.plan("DeviceType", TS, TT);
  assert.equal(planned.ok, true, planned.error);
  assert.deepEqual(planned.lines, [
    "моделей: 1",
    "устройств: 1",
    "типов: 2",
    "слотов: 1",
    "характеристик: 1",
    "связей: 2",
    "правил помещений: 2",
  ]);
  assert.deepEqual(planned.refs.dropLinks, [LT1]);
  const applied = await w.merge.apply("DeviceType", planned.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  const { db } = w;
  assert.deepEqual(db.DeviceType[TO1].attachableToTypeIds, [TT]);
  assert.deepEqual(db.DeviceType[TO2].attachableToTypeIds, [TT]);
  assert.deepEqual(db.Location[LOC1].responsibilityRules.deviceTypeOverrides, [{ deviceType: TT, responsibleUser: U2 }]);
  assert.deepEqual(db.Location[LOC2].responsibilityRules.deviceTypeOverrides, [{ deviceType: TT, responsibleUser: U1 }]);
  assert.deepEqual(db.DeviceType[TASM].assembly.slots, [{ typeId: TT, required: true }]);
  assert.deepEqual(db.DeviceType[TASM].assembly.keySpecs, [{ typeId: TT, source: "model", attributeId: null }]);
  // Связи атрибутов — объединение
  assert.equal(db.DeviceTypeAttribute[LT1], undefined);
  assert.equal(db.DeviceTypeAttribute[LT3].deviceTypeId, TT);
  assert.equal(db.DeviceModel[MM].deviceTypeId, TT);
  assert.equal(db.ClientDevice[D6].deviceTypeId, TT);
  // Цель: префикс прежний, «прикрепляется к» — объединение без самой цели
  assert.equal(db.DeviceType[TT].inventoryPrefix, "МШ");
  assert.deepEqual(db.DeviceType[TT].attachableToTypeIds, [TYPE1, TYPE2]);
  assert.equal(db.DeviceType[TS].isActive, false);
  assert.equal(db.DeviceType[TS].name, "Мышь (слито в «Мышь USB»)");
  // Повтор: ничего не пишется
  const before = w.writes.length;
  assert.equal((await w.merge.apply("DeviceType", planned.refs, { userId: USER })).ok, true);
  assert.equal(w.writes.length, before);
});

test("mergeAttributes: multiselect старой записью (не JSON) — одно значение; перенос — JSON-массивом", async () => {
  const w = attrWorld();
  const v = (attributeId, value) => ({ attributeId, value });
  const [M1, M2] = [11, 12].map((n) => oid("2", n));
  Object.assign(w.db.DeviceConfiguration, {
    // «чёрный» строкой = ["black"] у цели: не конфликт, значение источника убрано
    [M1]: { _id: M1, name: "a", deviceModelId: SRC, values: [v(ATTR_MS, "чёрный"), v(ATTR_MT, '["black"]')] },
    // строкой без цели: к цели — каноничным JSON-массивом
    [M2]: { _id: M2, name: "b", deviceModelId: TGT, values: [v(ATTR_MS, "серый")] },
  });
  const planned = await w.merge.plan("DeviceAttribute", ATTR_MS, ATTR_MT, { optionMap: { чёрный: "black", серый: "grey" } });
  assert.equal(planned.ok, true, planned.error);
  assert.deepEqual(planned.refs.values.drop, [M1]);
  assert.deepEqual(planned.refs.values.move, [{ id: M2, from: "серый", to: '["grey"]' }]);
  assert.equal((await w.merge.apply("DeviceAttribute", planned.refs, { userId: USER })).ok, true);
  assert.deepEqual(w.db.DeviceConfiguration[M1].values, [v(ATTR_MT, '["black"]')]);
  assert.deepEqual(w.db.DeviceConfiguration[M2].values, [v(ATTR_MT, '["grey"]')]);
});

test("mergeAttributes: у цели появилось значение между сверкой и записью — второго значения цели нет", async () => {
  const w = attrWorld();
  const snap = (await w.merge.plan("DeviceAttribute", ATTR_SRC, ATTR_TGT)).refs;
  const { store } = w;
  // Значение цели появляется сразу после сверки: перенос CA2 его не дублирует
  w.db.DeviceConfiguration[CA2].values.push({ attributeId: ATTR_TGT, value: "8" });
  const n = await store.moveValues({ ids: [CA2], source: ATTR_SRC, target: ATTR_TGT, from: "8", to: "8", userId: USER });
  assert.equal(n, 0);
  assert.equal(w.db.DeviceConfiguration[CA2].values.filter((x) => x.attributeId === ATTR_TGT).length, 1);
  assert.ok(snap);
});

test("mergeDeviceTypes: повтор после сбоя — ничего не переносится дважды", async () => {
  const w = typeWorld();
  const snap = (await w.merge.plan("DeviceType", TS, TT)).refs;
  // Записи: связь-дубль (1), модели (2), устройства (3), «прикрепляется к» (4), слоты (5 — сбой)
  w.crashAt = 5;
  const crashed = await w.merge.apply("DeviceType", snap, { userId: USER });
  assert.equal(crashed.ok, false);
  assert.deepEqual(crashed.moved, { связей: 1, моделей: 1, устройств: 1, типов: 2 });
  assert.equal(w.db.DeviceType[TS].isActive, true, "источник не гасится до конца переноса");
  assert.equal(await w.merge.drift("DeviceType", snap), null);
  const repeat = await w.merge.apply("DeviceType", snap, { userId: USER });
  assert.equal(repeat.ok, true, repeat.error);
  assert.deepEqual(repeat.moved, { слотов: 1, характеристик: 1, связей: 1, "правил помещений": 2 });
  assert.equal(w.db.DeviceType[TS].isActive, false);
  assert.equal(w.db.DeviceType[TS].name, "Мышь (слито в «Мышь USB»)");
  const before = w.writes.length;
  const third = await w.merge.apply("DeviceType", snap, { userId: USER });
  assert.equal(third.ok, true, third.error);
  assert.deepEqual(third.moved, {});
  assert.equal(w.writes.length, before);
  // Каждый документ по каждому пути — один раз; без дублей
  const rewired = w.writes.filter((x) => x.op === "rewire").map((x) => `${x.id}:${x.path}`);
  assert.equal(new Set(rewired).size, rewired.length);
  assert.deepEqual(w.db.DeviceType[TO1].attachableToTypeIds, [TT]);
  assert.deepEqual(w.db.DeviceType[TASM].assembly.slots, [{ typeId: TT, required: true }]);
  assert.deepEqual(w.db.Location[LOC1].responsibilityRules.deviceTypeOverrides, [{ deviceType: TT, responsibleUser: U2 }]);
  assert.equal(w.db.DeviceTypeAttribute[LT3].deviceTypeId, TT);
});

// --- Скрытие неиспользуемого: retire*/deleteGroup ---

const ATTR1 = oid("7", 1);
const G3 = oid("9", 3);

test("retireModel: живые устройства — отказ с числами", async () => {
  const w = world();
  const planned = await w.merge.planRetire("DeviceModel", SRC);
  assert.equal(planned.ok, false);
  assert.equal(planned.status, 409);
  assert.match(planned.error, /устройств: 2/);
  assert.match(planned.error, /сборок: 1/);
  assert.equal(w.writes.length, 0);
});

test("retireModel: только удалённые устройства — можно", async () => {
  const w = world();
  w.db.DeviceModel[MONO].name = "AIO";
  w.db.ClientDevice[D5] = { _id: D5, label: "Моно MN-1", deviceModelId: MONO, deletedAt: OLD };
  w.db.DeviceConfiguration[C_EMPTY] = { _id: C_EMPTY, name: "база", deviceModelId: MONO, values: [] };
  const planned = await w.merge.planRetire("DeviceModel", MONO);
  assert.equal(planned.ok, true, planned.error);
  assert.deepEqual(planned.lines, ["устройств: 1"]);
  const done = await w.merge.applyRetire("DeviceModel", planned.refs, { userId: USER });
  assert.equal(done.ok, true, done.error);
  const mono = w.db.DeviceModel[MONO];
  assert.equal(mono.deletedAt, NOW);
  assert.equal(mono.deletedBy, USER);
  assert.equal(mono.name, "AIO");
  // Удалённое устройство и конфигурация остались как были
  assert.equal(w.db.ClientDevice[D5].deviceModelId, MONO);
  assert.equal(w.db.DeviceConfiguration[C_EMPTY].deletedAt, undefined);
  assert.deepEqual(w.writes.map((x) => x.op), ["retire"]);
  // Повтор — без записи
  const again = await w.merge.applyRetire("DeviceModel", planned.refs, { userId: USER });
  assert.equal(again.ok, false);
  assert.equal(w.writes.length, 1);
});

test("retireModel: скрытая запись и несуществующая — отказ", async () => {
  const w = world();
  const hidden = await w.merge.planRetire("DeviceModel", DEAD);
  assert.equal(hidden.ok, false);
  assert.match(hidden.error, /скрыта/);
  assert.equal((await w.merge.planRetire("DeviceModel", oid("0", 9))).status, 404);
});

test("retireAttribute: при утверждении появилась связь — дрейф", async () => {
  const w = world();
  w.db.DeviceAttribute[ATTR1] = { _id: ATTR1, name: "Цвет", code: "color", isActive: true };
  const planned = await w.merge.planRetire("DeviceAttribute", ATTR1);
  assert.equal(planned.ok, true, planned.error);
  w.db.DeviceTypeAttribute[oid("8", 9)] = { _id: oid("8", 9), attributeId: ATTR1, deviceTypeId: TYPE1 };
  assert.match(await w.merge.driftRetire("DeviceAttribute", planned.refs), /^изменилось после предложения: на атрибут «Цвет» появил\S+ 1 нов\S+ связь/);
  const done = await w.merge.applyRetire("DeviceAttribute", planned.refs, { userId: USER });
  assert.equal(done.ok, false);
  assert.equal(done.status, 409);
  assert.equal(w.db.DeviceAttribute[ATTR1].isActive, true);
  assert.equal(w.writes.length, 0);
});

test("retireVendor/retireDeviceType: isActive:false, имя прежнее", async () => {
  const w = world();
  w.db.Vendor[VB].name = "Lenovo Group";
  delete w.db.DeviceModel[TGT];
  const planned = await w.merge.planRetire("Vendor", VB);
  // Модели у VB нет: TGT убран из мира
  assert.equal(planned.ok, true, planned.error);
  assert.equal((await w.merge.applyRetire("Vendor", planned.refs, { userId: USER })).ok, true);
  assert.deepEqual([w.db.Vendor[VB].isActive, w.db.Vendor[VB].name], [false, "Lenovo Group"]);
  // Тип с моделями — отказ
  assert.match((await w.merge.planRetire("DeviceType", TYPE1)).error, /моделей: /);
});

test("deleteGroup: пустая — удалена; со связями — отказ", async () => {
  const w = world();
  const busy = await w.merge.planRetire("AttributeGroup", G2);
  assert.equal(busy.ok, false);
  assert.match(busy.error, /связей: 1/);
  w.db.AttributeGroup[G3] = { _id: G3, name: "Пустая" };
  const planned = await w.merge.planRetire("AttributeGroup", G3);
  assert.equal(planned.ok, true, planned.error);
  // Связь появилась до применения — дрейф, группа на месте
  w.db.DeviceTypeAttribute[oid("8", 9)] = { _id: oid("8", 9), groupId: G3 };
  assert.match((await w.merge.applyRetire("AttributeGroup", planned.refs, { userId: USER })).error, /^изменилось после предложения: /);
  assert.ok(w.db.AttributeGroup[G3]);
  delete w.db.DeviceTypeAttribute[oid("8", 9)];
  assert.equal((await w.merge.applyRetire("AttributeGroup", planned.refs, { userId: USER })).ok, true);
  assert.equal(w.db.AttributeGroup[G3], undefined);
  assert.deepEqual(w.writes.map((x) => x.op), ["delete"]);
});

// ─── Финальная правка фазы 4 ──────────────────────────────────────────────────

test("retireAttribute: снимок несёт код атрибута (правило пакета: значения по коду)", async () => {
  const w = world();
  w.db.DeviceAttribute[ATTR1] = { _id: ATTR1, name: "Цвет", code: "Color", isActive: true };
  const planned = await w.merge.planRetire("DeviceAttribute", ATTR1);
  assert.equal(planned.ok, true, planned.error);
  assert.deepEqual(planned.refs.codes, ["color"]);
  // У других видов кодов нет
  w.db.Vendor[VB].name = "Lenovo Group";
  delete w.db.DeviceModel[TGT];
  assert.equal((await w.merge.planRetire("Vendor", VB)).refs.codes, undefined);
});

test("mergeConfigurations: модель конфигурации скрыта — отказ «модель «X» скрыта»", async () => {
  const w = configWorld([], []);
  w.db.DeviceModel[SRC].deletedAt = OLD;
  const planned = await w.merge.plan("DeviceConfiguration", CF_S, CF_T);
  assert.equal(planned.ok, false);
  assert.equal(planned.status, 409);
  assert.match(planned.error, /модель «Lenovo T14 G4» скрыта/);
  assert.equal(w.writes.length, 0);
});

test("безымянная конфигурация: в текстах и новом имени — имя модели, не «без названия»", async () => {
  const same = configWorld([{ attributeId: ATTR_TGT, value: "16" }], [{ attributeId: ATTR_TGT, value: "16" }]);
  same.db.DeviceConfiguration[CF_S].name = "";
  const ok = await same.merge.plan("DeviceConfiguration", CF_S, CF_T);
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.sourceName, "Lenovo T14 G4");
  assert.equal(ok.newName, "Lenovo T14 G4 (слито в «16/512 бис»)");
  const applied = await same.merge.apply("DeviceConfiguration", ok.refs, { userId: USER });
  assert.equal(applied.ok, true, applied.error);
  assert.equal(same.db.DeviceConfiguration[CF_S].name, "Lenovo T14 G4 (слито в «16/512 бис»)");
  // Пустая безымянная конфигурация модели получила значение — дрейф называет модель
  const again = world();
  again.db.DeviceConfiguration[C_EMPTY] = { _id: C_EMPTY, name: "", deviceModelId: SRC, values: [] };
  const snap = (await again.merge.plan("DeviceModel", SRC, TGT)).refs;
  again.db.DeviceConfiguration[C_EMPTY].values.push({ attributeId: "x", value: "4" });
  assert.equal(
    await again.merge.drift("DeviceModel", snap),
    "изменилось после предложения: конфигурация «Lenovo T14 G4» уже не пустая",
  );
});
