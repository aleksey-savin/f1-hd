// Слияние дублей справочника: все ссылки с источника переводятся на цель по
// явному снимку id, затем источник гасится. Виды операций — changeOps/mergeKinds.js,
// правила по видам записей (модель, атрибут, конфигурация, тип) — catalogMergeRules.js.
//
//   plan(entity, sourceId, targetId, { labels?, optionMap? }) -> { ok:true, refs (снимок),
//     conflicts:[], targets, lines, notes, deviceLabels, devices:[{ id, label }],
//     moreDevices, multiOn, collapse, newName, sourceName, targetName }
//     | { ok:false, status, error, conflicts? } (conflicts — строки перечня отказа)
//   drift(entity, snapshot) -> текст «изменилось после предложения: …» | null
//   apply(entity, snapshot, { userId }) -> { ok:true, moved:{ [countLabel]: n } } | { ok:false, status, error, moved? }
//     (moved при отказе — что успело перенестись до сбоя)
//
// entity — имя модели (Vendor, Supplier, AttributeGroup, DeviceModel, DeviceAttribute,
// DeviceConfiguration, DeviceType), как в REF_TABLE. notes — подстроки вида (варианты атрибута).
// Снимок (refs операции): { entity, source, target, refs: Refs из catalogRefs.find,
//   ...ключи правил вида (catalogMergeRules: retire, multiOn, collapse, optionMap, values, dropLinks…) }.
//
// Порядок применения:
//   1. пересчёт и сверка со снимком: новые ссылки и пропавшие (не на цель) — дрейф;
//      уже переведённые на цель (повтор после сбоя) и удалённые нами связи-дубли — не дрейф;
//   2. before вида (режим модели, варианты атрибута, удаление связей-дублей);
//   3. перенос по id снимка с условием «путь = источник» — повтор ничего не трогает дважды;
//   4. after вида (значения атрибута, совместимость модели, «прикрепляется к» типа);
//   5. гашение источника последним: переименование «A (слито в «B»)» и deletedAt
//      (модель, конфигурация) или isActive:false (вендор, поставщик, тип, атрибут —
//      у атрибута ещё и код «<code>_merged_<6 hex>»); группа удаляется насовсем.
// У модели до переноса: «Несколько конфигураций» у цели (multiOn) и значения
// пустой конфигурации цели (collapse.fill) — сбой посередине не ломает правило
// «вне режима нескольких — одна конфигурация».
// Повтор того же снимка через исполнитель отказывает дрейфом целей (перенос
// меняет их updatedAt); остаток после сбоя доносит новое предложение того же
// слияния — его снимок видит уже перенесённое на цель.
//
// Доступ к базе — через store (ленивый живой по умолчанию, тесты подставляют свой):
//   get(model, id) -> документ | null; describe(model, id) -> { name, hidden } | null
//   configurations(modelId) -> [{ _id, name, values, deletedAt, updatedAt }] (и удалённые)
//   configs(ids) -> [{ _id, name, deviceModelId, values, deletedAt }] — по id, порядок любой
//   rewire({ model, path, kind, ids, source, target, self, unique?, userId }) -> число изменённых
//     (self — id документа, который не должен ссылаться сам на себя: у массива id;
//     unique — у subdoc поля, при совпадении которых элемент источника рядом с элементом
//     цели снимается, а не дублируется; [] — достаточно цели)
//   updateTarget(model, id, { addToSet, set }, userId)
//   fillValues(configId, values, userId) — только если у конфигурации ещё нет значений
//   links(field, id) -> [{ _id, deviceTypeId, attributeId }] — связи тип↔атрибут по полю
//   dropLinks({ ids, field, source, userId }) -> число удалённых (только где field = источник)
//   addOptions(attributeId, [{ value, label }], userId) — только недостающие варианты
//   dropValues({ ids, source, userId }) -> число: значение атрибута-источника убрано
//   moveValues({ ids, source, target, from, to, userId }) -> число: значение from
//     атрибута-источника стало значением to цели (пустое значение цели снято;
//     документ с непустым значением цели не трогается)
//   retireMany(model, ids, { userId, now }) — deletedAt живым из ids
//   retire(model, id, { mode, name, set, userId, now }) -> false, если группа ещё со связями
//     (name не задан — запись не переименовывается: скрытие неиспользуемого)
//
// Скрытие неиспользуемого (retire*, deleteGroup) — те же refs и store, без цели:
//   planRetire(entity, id) -> { ok:true, refs (снимок { entity, source, refs, codes? }), lines, sourceName }
//     (codes — у атрибута: [код в нижнем регистре], для правила пакета)
//     | { ok:false, status, error } (отказ — живые ссылки, с числами)
//   driftRetire(entity, snapshot) -> текст | null (новая живая ссылка — дрейф)
//   applyRetire(entity, snapshot, { userId }) -> { ok:true, moved:{} } | { ok:false, status, error }
// Удалённые документы ссылкой не мешают (остаются в снимке: восстановленный — дрейф).
// Конфигурации модели не считаются: модель скрывается, они остаются как есть.
const { createCatalogRefs, countLines, liveStore: liveRefsStore } = require("./catalogRefs");
const { createMergeRules, fail, key, metaOf, quoted } = require("./catalogMergeRules");

const DRIFT = "изменилось после предложения";
const NO_SNAPSHOT = `${DRIFT}: нет снимка ссылок — предложите слияние заново`;

const hiddenDoc = (doc) => Boolean(doc?.deletedAt) || doc?.isActive === false;
// Новое имя слитого источника; у безымянного — подпись для людей
const mergedName = (sourceName, targetName) => `${sourceName} (слито в ${quoted(targetName)})`;

const createCatalogMerge = ({ refs, store, now = () => new Date() }) => {
  const nameOf = async (model, id, doc) => {
    const name = (await store.describe(model, id))?.name || doc?.name;
    if (name) return name;
    // Безымянная конфигурация — именем своей модели (как configLabel правил)
    const config = model === "DeviceConfiguration" ? (doc ?? (await store.get(model, id))) : null;
    return config?.deviceModelId ? nameOf("DeviceModel", String(config.deviceModelId)) : "без названия";
  };

  // Не переносятся: пустые конфигурации модели (гасятся) и сливаемая с конфигурацией цели
  const staying = (snapshot) => new Set([...(snapshot.retire ?? []), ...(snapshot.collapse ? [snapshot.collapse.source] : [])]);
  // adjusted объявлен ниже; правилам нужен поздно
  const RULES = createMergeRules({ refs, store, now, nameOf, staying, adjusted: (...args) => adjusted(...args) });

  // what — винительный падеж для текста дрейфа («на модель «X»…»), label/hidden — отказ
  const ENTITY = {
    Vendor: { what: "вендора", label: "вендор", hidden: "скрыт", retire: "inactive" },
    Supplier: { what: "поставщика", label: "поставщик", hidden: "скрыт", retire: "inactive" },
    AttributeGroup: { what: "группу", label: "группа", hidden: "скрыта", retire: "delete" },
    DeviceModel: { what: "модель", label: "модель", hidden: "скрыта", retire: "deleted", rules: RULES.DeviceModel },
    DeviceAttribute: { what: "атрибут", label: "атрибут", hidden: "скрыт", retire: "inactive", rules: RULES.DeviceAttribute },
    DeviceConfiguration: {
      what: "конфигурацию",
      label: "конфигурация",
      hidden: "скрыта",
      retire: "deleted",
      rules: RULES.DeviceConfiguration,
    },
    DeviceType: { what: "тип", label: "тип", hidden: "скрыт", retire: "inactive", rules: RULES.DeviceType },
  };
  const entityOf = (entity) => {
    if (!Object.hasOwn(ENTITY, entity)) throw new Error(`Слияние не поддерживается: ${entity}`);
    return ENTITY[entity];
  };

  // params — поля операции сверх source/target (optionMap атрибута)
  const plan = async (entity, sourceId, targetId, { labels = true, ...params } = {}) => {
    const meta = entityOf(entity);
    const source = String(sourceId);
    const target = String(targetId);
    if (source === target) return fail(400, "Нельзя слить запись саму в себя");
    const [src, tgt] = await Promise.all([store.get(entity, source), store.get(entity, target)]);
    if (!src || !tgt) return fail(404, "Запись не найдена");
    const [sourceName, targetName] = await Promise.all([nameOf(entity, source, src), nameOf(entity, target, tgt)]);
    if (hiddenDoc(src)) return fail(409, `Слить можно только живую запись: ${meta.label} ${quoted(sourceName)} ${meta.hidden}`);
    if (hiddenDoc(tgt)) return fail(409, `Сливать в скрытую запись нельзя: ${meta.label} ${quoted(targetName)} ${meta.hidden}`);
    const refused = await meta.rules?.check?.({ src, tgt, sourceName, targetName, params });
    if (refused) return refused;

    const snapshot = { entity, source, target, refs: await refs.find(entity, source) };
    const ruled = (await meta.rules?.plan?.({ snapshot, src, tgt, sourceName, targetName, params })) ?? {};
    if (ruled.ok === false) return ruled;
    Object.assign(snapshot, ruled.extra ?? {});
    const view = ruled.view ?? {};

    // Числа для человека: без того, что не переезжает (пустые конфигурации)
    const shown = snapshot.refs.map((entry) => {
      const skip = meta.rules?.skip?.(snapshot, entry) ?? new Set();
      if (!skip.size) return entry;
      const ids = entry.ids.filter((id) => !skip.has(id));
      const deletedIds = entry.deletedIds.filter((id) => !skip.has(id));
      return { ...entry, ids, live: ids.length - deletedIds.length, deleted: deletedIds.length, deletedIds };
    });

    // Первые 5 живых устройств — подписью, как их называют виды устройств
    const deviceEntry = snapshot.refs.find((r) => r.model === "ClientDevice");
    const liveDevices = (deviceEntry?.ids ?? []).filter((id) => !deviceEntry.deletedIds.includes(id));
    const devices = [];
    if (labels) {
      for (const id of liveDevices.slice(0, 5)) devices.push({ id, label: await nameOf("ClientDevice", id) });
    }
    return {
      ok: true,
      refs: snapshot,
      conflicts: [],
      targets: ruled.targets ?? [],
      lines: countLines(shown),
      deviceLabels: devices.map((d) => d.label),
      devices,
      moreDevices: Math.max(0, liveDevices.length - devices.length),
      multiOn: Boolean(view.multiOn),
      collapse: view.collapse ?? null,
      notes: view.notes ?? [],
      newName: mergedName(src.name || sourceName, tgt.name || targetName),
      sourceName,
      targetName,
    };
  };

  // Текущие ссылки в виде снимка: id, уже переведённые на цель, считаются на месте
  // (с прежней отметкой «удалено»), как и удалённые нами связи-дубли (dropLinks);
  // у retire отметка удаления — из снимка (их гасим мы)
  const adjusted = async (snapshot, current) => {
    const byKey = new Map(current.map((r) => [key(r), r]));
    const keep = staying(snapshot);
    const gone = new Set(snapshot.dropLinks ?? []);
    let onTarget = null;
    const out = [];
    for (const was of snapshot.refs) {
      const cur = byKey.get(key(was));
      byKey.delete(key(was));
      const ids = new Set(cur?.ids ?? []);
      const deleted = new Set(cur?.deletedIds ?? []);
      const missing = new Set(was.ids.filter((id) => !ids.has(id)));
      if (missing.size) {
        onTarget ??= new Map((await refs.find(snapshot.entity, snapshot.target)).map((r) => [key(r), new Set(r.ids)]));
        const there = onTarget.get(key(was)) ?? new Set();
        // Документ-цель в массиве id сам на себя не ссылается: снятый источник у него — перенос
        const self = was.model === snapshot.entity;
        for (const id of missing) if (there.has(id) || gone.has(id) || (self && id === snapshot.target)) ids.add(id);
      }
      for (const id of was.ids) {
        if (!ids.has(id) || !(keep.has(id) || missing.has(id))) continue;
        if (was.deletedIds.includes(id)) deleted.add(id);
        else deleted.delete(id);
      }
      const sorted = [...ids].sort();
      const deletedIds = sorted.filter((id) => deleted.has(id));
      out.push({ ...was, ids: sorted, live: sorted.length - deletedIds.length, deleted: deletedIds.length, deletedIds });
    }
    return [...out, ...byKey.values()];
  };

  const drift = async (entity, snapshot) => {
    const meta = entityOf(entity);
    if (!snapshot || snapshot.entity !== entity || !Array.isArray(snapshot.refs)) return NO_SNAPSHOT;
    const current = await refs.find(entity, snapshot.source);
    const [name, targetName] = await Promise.all([nameOf(entity, snapshot.source), nameOf(entity, snapshot.target)]);
    const { diff } = refs.same(snapshot.refs, await adjusted(snapshot, current), { entityLabel: meta.what, name });
    diff.push(...((await meta.rules?.drift?.({ snapshot, current, targetName })) ?? []));
    return diff.length ? `${DRIFT}: ${diff.join("; ")}` : null;
  };

  const apply = async (entity, snapshot, { userId } = {}) => {
    // Перенесённое до сбоя — и в отказ: итог операции покажет, что успело переехать
    const moved = {};
    const failed = (status, error) => ({ ...fail(status, error), ...(Object.keys(moved).length ? { moved } : {}) });
    let renaming = null;
    try {
      const meta = entityOf(entity);
      const drifted = await drift(entity, snapshot);
      if (drifted) return fail(409, drifted);
      const { source, target } = snapshot;
      const [src, tgt] = await Promise.all([store.get(entity, source), store.get(entity, target)]);
      if (!tgt) return fail(409, `${DRIFT}: цель слияния не найдена`);
      const targetName = tgt.name || (await nameOf(entity, target, tgt));
      if (hiddenDoc(tgt)) return fail(409, `${DRIFT}: ${meta.label} ${quoted(targetName)} ${meta.hidden}`);

      const count = (part) => {
        for (const [label, n] of Object.entries(part ?? {})) if (n) moved[label] = (moved[label] ?? 0) + n;
      };
      count(await meta.rules?.before?.({ snapshot, src, tgt, userId }));
      for (const entry of snapshot.refs) {
        const ref = metaOf(entity, entry);
        if (!ref || meta.rules?.own?.(entry)) continue;
        const skip = meta.rules?.skip?.(snapshot, entry) ?? new Set();
        const ids = entry.ids.filter((id) => !skip.has(id));
        if (!ids.length) continue;
        const self = ref.model === entity ? target : null;
        const extra = meta.rules?.rewire?.(entry) ?? {};
        count({ [ref.countLabel]: await store.rewire({ ...ref, ...extra, ids, source, target, self, userId }) });
      }
      if (src) count(await meta.rules?.after?.({ snapshot, src, tgt, userId }));

      // Источник — последним; повтор над уже погашенным ничего не пишет
      if (src) {
        const sourceName = src.name || (await nameOf(entity, source, src));
        renaming = { sourceName, name: mergedName(sourceName, targetName) };
        const set = meta.rules?.retireSet?.(src, source) ?? {};
        const done = await store.retire(entity, source, { mode: meta.retire, name: renaming.name, set, userId, now: now() });
        // Только группа: связь появилась между сверкой и удалением
        if (done === false) return failed(409, `${DRIFT}: в группе ${quoted(src.name)} остались связи`);
      }
      return { ok: true, moved };
    } catch (error) {
      // Имя слитого занято: ссылки уже у цели, не погашен только источник
      if (error?.code === 11000 && renaming) {
        return failed(
          409,
          `ссылки перенесены, но ${quoted(renaming.sourceName)} не скрыт: имя ${quoted(renaming.name)} уже занято — ` +
            "переименуйте запись с этим именем и повторите слияние",
        );
      }
      if (error?.code === 11000) return failed(409, "Такая запись уже есть в справочнике");
      return { ...failed(500, "Не удалось слить записи"), exception: error };
    }
  };

  // --- скрытие неиспользуемого ---
  const RETIRABLE = ["Vendor", "Supplier", "AttributeGroup", "DeviceModel", "DeviceAttribute", "DeviceType"];
  const IGNORED = { DeviceModel: new Set(["DeviceConfiguration:deviceModelId"]) };
  const retirable = (entity) => {
    if (!RETIRABLE.includes(entity)) throw new Error(`Скрытие не поддерживается: ${entity}`);
    return ENTITY[entity];
  };
  const used = (entity, list) => list.filter((r) => !IGNORED[entity]?.has(key(r)));
  // Только живые ссылки: удалённые не мешают и не считаются дрейфом
  const liveOnly = (list) =>
    list.map((r) => {
      const ids = r.ids.filter((id) => !r.deletedIds.includes(id));
      return { ...r, ids, live: ids.length, deleted: 0, deletedIds: [] };
    });

  const planRetire = async (entity, id) => {
    const meta = retirable(entity);
    const doc = await store.get(entity, String(id));
    if (!doc) return fail(404, "Запись не найдена");
    const name = await nameOf(entity, String(id), doc);
    if (hiddenDoc(doc)) return fail(409, `Скрыть можно только живую запись: ${meta.label} ${quoted(name)} ${meta.hidden}`);
    const found = used(entity, await refs.find(entity, String(id)));
    const live = liveOnly(found).filter((r) => r.live > 0);
    if (live.length) {
      const list = countLines(live).join(", ");
      const text = meta.retire === "delete" ? `Удалить нельзя: в группе ${quoted(name)} есть связи (${list})` : `Скрыть нельзя: ${meta.label} ${quoted(name)} используется (${list})`;
      return fail(409, text);
    }
    // Только удалённые документы: «устройств: 3»
    const lines = countLines(found.filter((r) => r.deleted > 0).map((r) => ({ ...r, live: r.deleted, deleted: 0 })));
    // Код атрибута — правилу пакета (значения называют атрибут кодом, mentions retireAttribute)
    const codes = entity === "DeviceAttribute" && doc.code ? { codes: [String(doc.code).toLowerCase()] } : {};
    return { ok: true, refs: { entity, source: String(id), refs: found, ...codes }, lines, sourceName: name };
  };

  const driftRetire = async (entity, snapshot) => {
    const meta = retirable(entity);
    if (!snapshot || snapshot.entity !== entity || !Array.isArray(snapshot.refs)) return NO_SNAPSHOT;
    const doc = await store.get(entity, snapshot.source);
    if (!doc) return `${DRIFT}: запись не найдена`;
    const name = await nameOf(entity, snapshot.source, doc);
    if (hiddenDoc(doc)) return `${DRIFT}: ${meta.label} ${quoted(name)} ${meta.hidden}`;
    const current = liveOnly(used(entity, await refs.find(entity, snapshot.source)));
    const { diff } = refs.same(liveOnly(snapshot.refs), current, { entityLabel: meta.what, name });
    return diff.length ? `${DRIFT}: ${diff.join("; ")}` : null;
  };

  const applyRetire = async (entity, snapshot, { userId } = {}) => {
    try {
      const meta = retirable(entity);
      const drifted = await driftRetire(entity, snapshot);
      if (drifted) return fail(409, drifted);
      const done = await store.retire(entity, snapshot.source, { mode: meta.retire, userId, now: now() });
      // Только группа: связь появилась между сверкой и удалением
      if (done === false) return fail(409, `${DRIFT}: в группе остались связи`);
      return { ok: true, moved: {} };
    } catch (error) {
      return { ...fail(500, "Не удалось скрыть запись"), exception: error };
    }
  };

  return { plan, drift, apply, planRetire, driftRetire, applyRetire };
};

// Боевое хранилище: модели грузятся при первом обращении; не покрыто тестами (нужна база)
const liveStore = () => {
  const lazy = (path) => {
    let loaded;
    return () => (loaded ??= require(path));
  };
  const MODELS = {
    ClientDevice: lazy("../../models/inventory/clientDevice"),
    DeviceModel: lazy("../../models/inventory/deviceModel"),
    DeviceType: lazy("../../models/inventory/deviceType"),
    DeviceConfiguration: lazy("../../models/inventory/deviceConfiguration"),
    DeviceBuild: lazy("../../models/inventory/deviceBuild"),
    DeviceTypeAttribute: lazy("../../models/inventory/deviceTypeAttribute"),
    DeviceAttribute: lazy("../../models/inventory/deviceAttribute"),
    Location: lazy("../../models/inventory/location"),
    Vendor: lazy("../../models/inventory/vendor"),
    Supplier: lazy("../../models/inventory/supplier"),
    AttributeGroup: lazy("../../models/inventory/attributeGroup"),
  };
  const names = lazy("./changeOps/names");
  const mongoose = lazy("mongoose");
  const oid = (id) => new (mongoose().Types.ObjectId)(String(id));
  const stampOf = (userId) => (userId ? { updatedBy: userId } : {});

  return {
    get: (model, id) => MODELS[model]().findById(id).lean(),
    describe: (model, id) => names().describe(model, id),
    configurations: (modelId) =>
      MODELS.DeviceConfiguration().find({ deviceModelId: modelId }).select("name values deletedAt updatedAt").lean(),
    configs: (ids) =>
      MODELS.DeviceConfiguration()
        .find({ _id: { $in: ids.map(oid) } })
        .select("name deviceModelId values deletedAt updatedAt")
        .lean(),
    // Только документы снимка и только те, где путь ещё указывает на источник
    rewire: async ({ model, path, kind, ids, source, target, self, unique, userId }) => {
      const M = MODELS[model]();
      const src = oid(source);
      const tgt = oid(target);
      const scope = { _id: { $in: ids.map(oid) }, [path]: src };
      const stamp = stampOf(userId);
      if (kind === "single") return (await M.updateMany(scope, { $set: { [path]: tgt, ...stamp } })).modifiedCount;
      if (kind === "subdoc") {
        // Путь делится по последней точке: список (может лежать в объекте —
        // responsibilityRules.deviceTypeOverrides, assembly.slots) и поле элемента
        const at = path.lastIndexOf(".");
        const list = path.slice(0, at);
        const field = path.slice(at + 1);
        let pulled = 0;
        if (unique) {
          // Элемент источника, у которого в том же документе есть пара с целью, снимается
          const keyOf = (el) => unique.map((f) => String(el[f] ?? null)).join("|");
          for (const doc of await M.find(scope).select(list).lean()) {
            const items = list.split(".").reduce((v, k) => v?.[k], doc) ?? [];
            const have = new Set(items.filter((el) => String(el[field]) === String(target)).map(keyOf));
            for (const el of items.filter((x) => String(x[field]) === String(source) && have.has(keyOf(x)))) {
              const match = { [field]: src, ...Object.fromEntries(unique.map((f) => [f, el[f] ?? null])) };
              const result = await M.updateOne(
                { _id: doc._id, [path]: src },
                { $pull: { [list]: match }, ...(userId ? { $set: stamp } : {}) },
              );
              pulled += result.modifiedCount;
            }
          }
        }
        const result = await M.updateMany(
          scope,
          { $set: { [`${list}.$[e].${field}`]: tgt, ...stamp } },
          { arrayFilters: [{ [`e.${field}`]: src }] },
        );
        return pulled + result.modifiedCount;
      }
      // Массив id: цель уже есть (или это сам документ-цель) — источник снимается,
      // иначе заменяется на цель на том же месте; без дублей
      const pulled = await M.updateMany(
        { ...scope, $or: [{ [path]: tgt }, ...(self ? [{ _id: oid(self) }] : [])] },
        { $pull: { [path]: src }, ...(userId ? { $set: stamp } : {}) },
      );
      const replaced = await M.updateMany(scope, { $set: { [`${path}.$[e]`]: tgt, ...stamp } }, { arrayFilters: [{ e: src }] });
      return pulled.modifiedCount + replaced.modifiedCount;
    },
    updateTarget: async (model, id, { addToSet = {}, set = {} }, userId) => {
      const update = {};
      const add = Object.entries(addToSet).filter(([, list]) => list.length);
      if (add.length) update.$addToSet = Object.fromEntries(add.map(([path, list]) => [path, { $each: list.map(oid) }]));
      update.$set = { ...set, ...stampOf(userId) };
      await MODELS[model]().updateOne({ _id: id }, update);
      return true;
    },
    // Значения пустой конфигурации цели; уже заполненную не трогает (повтор — без записи)
    fillValues: async (configId, values, userId) => {
      const result = await MODELS.DeviceConfiguration().updateOne(
        { _id: oid(configId), values: { $not: { $elemMatch: { value: { $nin: [null, "", "[]"] } } } } },
        { $set: { values: values.map((v) => ({ attributeId: oid(v.attributeId), value: v.value })), ...stampOf(userId) } },
      );
      return result.modifiedCount > 0;
    },
    links: (field, id) => MODELS.DeviceTypeAttribute().find({ [field]: oid(id) }).select("deviceTypeId attributeId").lean(),
    // Связи-дубли: только из снимка и только пока поле указывает на источник
    dropLinks: async ({ ids, field, source }) => {
      const result = await MODELS.DeviceTypeAttribute().deleteMany({ _id: { $in: ids.map(oid) }, [field]: oid(source) });
      return result.deletedCount;
    },
    // По одному варианту с условием «такого ещё нет» — повтор ничего не добавляет
    addOptions: async (id, options, userId) => {
      let n = 0;
      for (const option of options) {
        const result = await MODELS.DeviceAttribute().updateOne(
          { _id: oid(id), "options.value": { $ne: option.value } },
          { $push: { options: { value: option.value, label: option.label } }, $set: stampOf(userId) },
        );
        n += result.modifiedCount;
      }
      return n;
    },
    dropValues: async ({ ids, source, userId }) => {
      const src = oid(source);
      const result = await MODELS.DeviceConfiguration().updateMany(
        { _id: { $in: ids.map(oid) }, "values.attributeId": src },
        { $pull: { values: { attributeId: src } }, ...(userId ? { $set: stampOf(userId) } : {}) },
      );
      return result.modifiedCount;
    },
    // Условие — значение источника всё ещё from и у цели нет непустого значения
    // (появилось после сверки — документ не трогаем, двух значений цели не будет):
    // сначала снимается пустое значение цели, затем элемент источника становится
    // элементом цели на том же месте
    moveValues: async ({ ids, source, target, from, to, userId }) => {
      const M = MODELS.DeviceConfiguration();
      const src = oid(source);
      const tgt = oid(target);
      const BLANK = [null, "", "[]"];
      const scope = {
        _id: { $in: ids.map(oid) },
        $and: [
          { values: { $elemMatch: { attributeId: src, value: from } } },
          { values: { $not: { $elemMatch: { attributeId: tgt, value: { $nin: BLANK } } } } },
        ],
      };
      await M.updateMany(scope, { $pull: { values: { attributeId: tgt, value: { $in: BLANK } } } });
      const result = await M.updateMany(
        scope,
        { $set: { "values.$[e].attributeId": tgt, "values.$[e].value": to, ...stampOf(userId) } },
        { arrayFilters: [{ "e.attributeId": src, "e.value": from }] },
      );
      return result.modifiedCount;
    },
    retireMany: async (model, ids, { userId, now }) => {
      const result = await MODELS[model]().updateMany(
        { _id: { $in: ids.map(oid) }, deletedAt: null },
        { $set: { deletedAt: now, ...(userId ? { deletedBy: userId } : {}) } },
      );
      return result.modifiedCount;
    },
    // Условие на «ещё не погашен» — повтор ничего не переименовывает дважды
    retire: async (model, id, { mode, name, set: extra = {}, userId, now }) => {
      const M = MODELS[model]();
      if (mode === "delete") {
        if (await MODELS.DeviceTypeAttribute().exists({ groupId: id })) return false;
        await M.deleteOne({ _id: id });
        return true;
      }
      const deleted = mode === "deleted";
      const filter = deleted ? { _id: id, deletedAt: null } : { _id: id, isActive: { $ne: false } };
      const named = name === undefined ? {} : { name };
      const set = deleted ? { ...named, deletedAt: now, ...(userId ? { deletedBy: userId } : {}) } : { ...named, isActive: false };
      await M.updateOne(filter, { $set: { ...set, ...extra, ...stampOf(userId) } });
      return true;
    },
  };
};

let defaultMerge;
const instance = () => (defaultMerge ??= createCatalogMerge({ refs: createCatalogRefs({ store: liveRefsStore }), store: liveStore() }));

module.exports = {
  createCatalogMerge,
  liveStore,
  plan: (...args) => instance().plan(...args),
  drift: (...args) => instance().drift(...args),
  apply: (...args) => instance().apply(...args),
  planRetire: (...args) => instance().planRetire(...args),
  driftRetire: (...args) => instance().driftRetire(...args),
  applyRetire: (...args) => instance().applyRetire(...args),
};
