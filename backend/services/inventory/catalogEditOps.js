// Правка записей каталога от ИИ-агента: вендор, поставщик, модель, тип, группа,
// атрибут, связь тип↔атрибут, конфигурация, шаблон сборки.
// Правила имён — как у обработчиков контроллеров (vendor, supplier, deviceModel,
// deviceType, attributeGroup): у вендора, поставщика и типа имя уникально с
// учётом регистра, у группы — без, у модели — среди живых моделей, у атрибута —
// точное совпадение имени (в старых базах висит unique name_1; код не правится).
// Сверх формы портала: опасные правки типа (комплектующее у типа в чужом слоте,
// скрытие типа с живыми моделями) и снятие атрибута с типа (keySpecs, значения)
// отказывают здесь, а не портят данные тихо.
//
// У каждого вида пара: check<Kind>(args, { allowNoop, snapshot? }) без записей и
// apply<Kind>(args, { userId, snapshot? }); обе строятся из одного плана.
// args — { id, ...поля } (у связи — { type, attribute, ...поля }).
//   check* -> { ok:true, before, ...дополнения вида } | { ok:false, status, message }
//   (дополнение targets — свои цели сверки дрейфа сверх параметров, у связи — сама связь)
//   apply* -> { ok:true, id }     | { ok:false, status, message }
// before — только изменённые поля, показом для людей: имена вместо id, «да»/«нет»,
// списки имён через «, ». Без изменений — отказ (кроме allowNoop: при применении
// проверка идёт заново, и повтор уже сделанного — не ошибка).
// Дополнения: атрибут — { added, renames:[{ from, to, live, deleted }], refs },
// конфигурация — { values:[{ field, name, value|null, before }] }.
//
// renameOptions и снимок refs. Значения select/multiselect в конфигурациях —
// текст варианта, поэтому снимок — свой запрос, а не catalogRefs.find. Запись
// снимка на каждое переименование (форма Refs из catalogRefs, сверка — его same):
//   { model:"DeviceConfiguration", path:"values.value", attributeId, option: from,
//     ids, live, deleted, deletedIds }
// ids — конфигурации (и удалённые), где значение атрибута содержит from. При
// применении (snapshot задан; null — снимка нет) список считается заново:
// расхождение — дрейф, отказ. Запись: сначала атрибут, затем конфигурации ровно
// по ids снимка с условием на старое значение, так что повтор после сбоя
// дописывает остаток и ничего не трогает дважды.
//
// Доступ к базе — через store (ленивый живой по умолчанию, тесты подставляют свой):
//   get(kind, id) -> документ | null
//   nameHolder(kind, name, exceptId) -> { _id, name, isActive? } | null
//   find(kind, ids) -> [{ _id, name }] (модель — «Вендор Модель»; живые)
//   liveModelCount(typeId), slotOwners(typeId) -> имена других типов со слотом
//   update(kind, id, patch, userId) — undefined в patch снимает значение
//   parseGroupName(raw) -> { name } | { error }
//   configValues(attributeId) -> [{ _id, value, deletedAt? }] — конфигурации со значением
//   rewriteValue(configId, attributeId, oldValue, newValue, userId) — только если значение прежнее
//   typeLink(typeId, attributeId) -> { _id, required, order, groupId, updatedAt } | null
//   updateLink(linkId, patch, userId), deleteLink(linkId)
//   keySpecOwners(typeId, attributeId) -> имена типов, где атрибут типа — ключевая характеристика
//   typeValueCount(typeId, attributeId) -> живых конфигураций живых моделей типа со значением
//   attributesByCode(codes) -> [атрибут], linkedAttributeIds(typeId) -> [id]
//   buildFields(typeId, body) -> { parts } | { error: { status, message } } — правила createBuild
const catalogSeed = require("./catalogSeed");
const { createCatalogRefs, plural } = require("./catalogRefs");
const { isValidValue, storedValue, renameValue: renamed } = require("./attributeValue");
const { formatSpecValue, parseMultiValue } = require("./assemblyKeySpecs");

const fail = (status, message) => ({ ok: false, status, message });
const str = (value) => (typeof value === "string" ? value.trim() : "");
const yesNo = (value) => (value ? "да" : "нет");
const EMPTY = "не задано";

// Живой store: модели и обработчики грузятся при первом обращении
const liveStore = () => {
  const lazy = (path) => {
    let loaded;
    return () => (loaded ??= require(path));
  };
  const MODELS = {
    vendor: lazy("../../models/inventory/vendor"),
    supplier: lazy("../../models/inventory/supplier"),
    model: lazy("../../models/inventory/deviceModel"),
    type: lazy("../../models/inventory/deviceType"),
    group: lazy("../../models/inventory/attributeGroup"),
    attribute: lazy("../../models/inventory/deviceAttribute"),
    configuration: lazy("../../models/inventory/deviceConfiguration"),
    build: lazy("../../models/inventory/deviceBuild"),
  };
  const Vendor = lazy("../../models/inventory/vendor");
  const Link = lazy("../../models/inventory/deviceTypeAttribute");
  const builds = lazy("../../controllers/inventory/deviceBuild");
  const mongoose = lazy("mongoose");
  const oid = (id) => new (mongoose().Types.ObjectId)(String(id));
  const COLLATION = { locale: "ru", strength: 2 };

  return {
    get: (kind, id) => MODELS[kind]().findById(id).lean(),
    nameHolder: (kind, name, exceptId) => {
      const filter = { name, _id: { $ne: exceptId }, ...(kind === "model" ? { deletedAt: null } : {}) };
      const query = MODELS[kind]().findOne(filter).select("name isActive");
      return (kind === "group" ? query.collation(COLLATION) : query).lean();
    },
    find: async (kind, ids) => {
      const docs = await MODELS[kind]()
        .find({ _id: { $in: ids }, ...(kind === "model" ? { deletedAt: null } : {}) })
        .select("name vendorId")
        .lean();
      if (kind !== "model") return docs;
      const vendors = await Vendor()
        .find({ _id: { $in: docs.map((doc) => doc.vendorId).filter(Boolean) } })
        .select("name")
        .lean();
      const byId = new Map(vendors.map((v) => [String(v._id), v.name]));
      return docs.map((doc) => ({
        _id: doc._id,
        name: [byId.get(String(doc.vendorId)), doc.name].filter(Boolean).join(" "),
      }));
    },
    liveModelCount: (typeId) => MODELS.model().countDocuments({ deviceTypeId: typeId, deletedAt: null }),
    slotOwners: async (typeId) => {
      const owners = await MODELS.type()
        .find({ _id: { $ne: typeId }, "assembly.slots.typeId": typeId })
        .select("name")
        .lean();
      return owners.map((owner) => owner.name);
    },
    update: async (kind, id, patch, userId) => {
      const doc = await MODELS[kind]().findById(id);
      if (!doc) return false;
      for (const [key, value] of Object.entries(patch)) doc.set(key, value);
      if (userId) doc.updatedBy = userId;
      await doc.save();
      return true;
    },
    parseGroupName: (raw) => require("../../controllers/inventory/attributeGroup").parseGroupName(raw),
    configValues: async (attributeId) => {
      const docs = await MODELS.configuration()
        .find({ "values.attributeId": attributeId })
        .select("values deletedAt")
        .lean();
      return docs.map((doc) => ({
        _id: String(doc._id),
        deletedAt: doc.deletedAt,
        value: doc.values.find((v) => String(v.attributeId) === String(attributeId))?.value ?? "",
      }));
    },
    // Одна конфигурация по id, с условием на прежнее значение: повтор — без записи
    rewriteValue: async (configId, attributeId, oldValue, newValue, userId) => {
      const attr = oid(attributeId);
      const result = await MODELS.configuration().updateOne(
        { _id: configId, values: { $elemMatch: { attributeId: attr, value: oldValue } } },
        { $set: { "values.$[v].value": newValue, ...(userId ? { updatedBy: userId } : {}) } },
        { arrayFilters: [{ "v.attributeId": attr, "v.value": oldValue }] },
      );
      return result.modifiedCount > 0;
    },
    typeLink: (typeId, attributeId) => Link().findOne({ deviceTypeId: typeId, attributeId }).lean(),
    updateLink: async (linkId, patch, userId) => {
      const link = await Link().findById(linkId);
      if (!link) return false;
      for (const [key, value] of Object.entries(patch)) link.set(key, value);
      if (userId) link.updatedBy = userId;
      await link.save();
      return true;
    },
    deleteLink: async (linkId) => (await Link().deleteOne({ _id: linkId })).deletedCount > 0,
    keySpecOwners: async (typeId, attributeId) => {
      const owners = await MODELS.type()
        .find({ "assembly.keySpecs": { $elemMatch: { typeId, attributeId } } })
        .select("name")
        .lean();
      return owners.map((owner) => owner.name);
    },
    typeValueCount: async (typeId, attributeId) => {
      const models = await MODELS.model().find({ deviceTypeId: typeId, deletedAt: null }).select("_id").lean();
      if (!models.length) return 0;
      return MODELS.configuration().countDocuments({
        deviceModelId: { $in: models.map((m) => m._id) },
        deletedAt: null,
        values: { $elemMatch: { attributeId, value: { $nin: [null, ""] } } },
      });
    },
    attributesByCode: (codes) => MODELS.attribute().find({ code: { $in: codes } }).lean(),
    linkedAttributeIds: async (typeId) =>
      (await Link().find({ deviceTypeId: typeId }).select("attributeId").lean()).map((l) => String(l.attributeId)),
    // Тип сборки не меняется — слоты её типа; детали и их ссылки — buildFields контроллера
    buildFields: async (typeId, body) => {
      const loaded = await builds().loadAssemblyType(typeId);
      if (loaded.error) return { error: { status: loaded.error.statusCode, message: loaded.error.message } };
      const fields = await builds().buildFields(body, loaded.slots);
      if (fields.error) return { error: { status: fields.error.statusCode, message: fields.error.message } };
      return { parts: fields.parts };
    },
  };
};

const ids = (list) => (Array.isArray(list) ? list.map(String) : []);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// Имена по id в порядке списка, пропавшие — молча без имени
const namesOf = async (store, kind, list) => {
  const found = new Map((await store.find(kind, list)).map((doc) => [String(doc._id), doc.name]));
  return list.map((id) => found.get(id)).filter(Boolean);
};

/**
 * Поля вида: name -> { type, read(doc), same(a, b), show(store, value) }.
 *   string — строка (пустая = снять); bool; list — список id (имена по kind);
 *   ref — одиночная ссылка (имя по kind); number.
 */
const FIELDS = {
  name: { type: "string", required: true },
  isActive: { type: "bool", def: true },
  website: { type: "string" },
  inn: { type: "string" },
  kpp: { type: "string" },
  notes: { type: "string" },
  vendorId: { type: "ref", kind: "vendor" },
  compatibleWithModelIds: { type: "list", kind: "model" },
  isComponent: { type: "bool", def: false },
  isConsumable: { type: "bool", def: false },
  isPeripheral: { type: "bool", def: false },
  inventoryPrefix: { type: "string", upper: true },
  attachableToTypeIds: { type: "list", kind: "type" },
  order: { type: "number", def: 0 },
  unit: { type: "string" },
  description: { type: "string" },
  required: { type: "bool", def: false },
  groupId: { type: "ref", kind: "group", nullable: true, empty: "без группы" },
};

// Что можно менять у вида (порядок — порядок проверок и before)
const EDITABLE = {
  vendor: ["name", "isActive"],
  supplier: ["name", "isActive", "website", "inn", "kpp", "notes"],
  model: ["name", "vendorId", "notes", "compatibleWithModelIds"],
  type: ["name", "isActive", "isComponent", "isConsumable", "isPeripheral", "inventoryPrefix", "attachableToTypeIds"],
  group: ["name", "order"],
  attribute: ["name", "unit", "isActive"],
  configuration: ["name", "description"],
  build: ["name", "notes"],
};

const NAME_EMPTY = {
  vendor: "Укажите название вендора",
  supplier: "Укажите название поставщика",
  model: "Укажите название модели",
  type: "Укажите название типа",
  attribute: "Укажите название атрибута",
  configuration: "Укажите название конфигурации",
  build: "Укажите название сборки",
};
const NAME_TAKEN = {
  vendor: (name) => `Вендор «${name}» уже есть`,
  supplier: (name) => `Поставщик «${name}» уже есть в справочнике`,
  model: (name) => `Модель «${name}» уже есть`,
  type: (name) => `Тип «${name}» уже есть`,
  group: (name) => `Группа «${name}» уже есть`,
  attribute: (name) => `Атрибут «${name}» уже есть`,
};

// Новое значение поля в форме документа | { error }
const normalize = (spec, name, value, kind) => {
  if (spec.type === "bool") return typeof value === "boolean" ? { value } : { error: `Неверное значение поля «${name}»` };
  if (spec.type === "number") {
    const number = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(number) ? { value: number } : { error: `Неверное значение поля «${name}»` };
  }
  if (spec.type === "list") {
    return Array.isArray(value) ? { value: [...new Set(ids(value))] } : { error: `Неверное значение поля «${name}»` };
  }
  if (spec.type === "ref") {
    if (value === null && spec.nullable) return { value: undefined };
    return typeof value === "string" ? { value } : { error: `Неверное значение поля «${name}»` };
  }
  if (value != null && typeof value !== "string") return { error: `Неверное значение поля «${name}»` };
  const text = str(value);
  if (name === "name" && !text) return { error: NAME_EMPTY[kind] };
  return { value: text ? (spec.upper ? text.toUpperCase() : text) : undefined };
};

const currentOf = (spec, name, doc) => {
  const raw = doc[name];
  if (spec.type === "list") return ids(raw);
  if (spec.type === "ref") return raw ? String(raw) : undefined;
  if (spec.type === "string") return str(raw) || undefined;
  return raw ?? spec.def;
};

const same = (spec, a, b) => (spec.type === "list" ? sameSet(a, b) : a === b);

const show = async (store, spec, value) => {
  if (spec.type === "bool") return yesNo(value);
  if (spec.type === "number") return String(value);
  if (spec.type === "list") return value.length ? (await namesOf(store, spec.kind, value)).join(", ") || EMPTY : "нет";
  if (spec.type === "ref") return value ? ((await namesOf(store, spec.kind, [value]))[0] ?? EMPTY) : (spec.empty ?? EMPTY);
  return value ?? EMPTY;
};

// Правила вида сверх формы: -> fail | null. doc — до правки, next — что станет
const kindRules = {
  model: async (store, doc, next) => {
    if (doc.deletedAt) return fail(404, "Модель удалена");
    if (next.vendorId !== undefined) {
      const vendor = await store.get("vendor", next.vendorId);
      if (!vendor) return fail(400, "Вендор не найден");
      if (vendor.isActive === false) return fail(400, `Вендор «${vendor.name}» скрыт`);
    }
    if (next.compatibleWithModelIds !== undefined) {
      const list = next.compatibleWithModelIds;
      if (list.includes(String(doc._id))) return fail(400, "Модель не может быть совместима сама с собой");
      if ((await store.find("model", list)).length !== list.length) return fail(400, "Совместимая модель не найдена");
    }
    return null;
  },
  type: async (store, doc, next) => {
    if (next.attachableToTypeIds !== undefined) {
      const list = next.attachableToTypeIds;
      if (list.includes(String(doc._id))) return fail(400, "Тип не может прикрепляться сам к себе");
      if ((await store.find("type", list)).length !== list.length) return fail(400, "Тип для прикрепления не найден");
    }
    if (next.isComponent === false && doc.isComponent) {
      const owners = await store.slotOwners(doc._id);
      if (owners.length) {
        return fail(409, `Нельзя снять «комплектующее» у типа «${doc.name}»: он стоит в слоте типов ${owners.map((n) => `«${n}»`).join(", ")}`);
      }
    }
    if (next.isActive === false && doc.isActive !== false) {
      const count = await store.liveModelCount(doc._id);
      if (count > 0) return fail(409, `Нельзя скрыть тип «${doc.name}»: у него есть модели (${count})`);
    }
    return null;
  },
};

// Поля правки: { set, next, before } | fail. doc — до правки, names — порядок полей
const diffFields = async (store, kind, names, args, doc) => {
  const set = {};
  const next = {};
  const before = {};
  for (const name of names) {
    if (args[name] === undefined) continue;
    const spec = FIELDS[name];
    const raw = kind === "group" && name === "name" ? store.parseGroupName(args[name]) : null;
    if (raw?.error) return fail(400, raw.error);
    const parsed = normalize(spec, name, raw ? raw.name : args[name], kind);
    if (parsed.error) return fail(400, parsed.error);
    const current = currentOf(spec, name, doc);
    if (same(spec, current, parsed.value)) continue;
    next[name] = parsed.value;
    set[name] = parsed.value;
    before[name] = await show(store, spec, current);
  }
  return { ok: true, set, next, before };
};

// --- варианты атрибута ---------------------------------------------------------

const OPTION_TYPES = new Set(["select", "multiselect"]);
const DRIFT = "изменилось после предложения";
const isStrings = (list) => Array.isArray(list) && list.every((item) => typeof item === "string");
const snapshotSame = createCatalogRefs({ store: null }).same;

// Значение после переименований — renameValue (attributeValue.js)
// Снимок по варианту: конфигурации, где значение атрибута содержит option
const optionRefs = (attr, rows, option) => {
  const hit = rows
    .filter((row) => (attr.valueType === "multiselect" ? parseMultiValue(row.value).includes(option) : row.value === option))
    .map((row) => ({ id: String(row._id), deleted: Boolean(row.deletedAt) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const deletedIds = hit.filter((row) => row.deleted).map((row) => row.id);
  return {
    model: "DeviceConfiguration",
    path: "values.value",
    attributeId: String(attr._id),
    // код — для правила пакета (mentions): setValues называют атрибут кодом
    code: String(attr.code ?? "").toLowerCase(),
    option,
    ids: hit.map((row) => row.id),
    live: hit.length - deletedIds.length,
    deleted: deletedIds.length,
    deletedIds,
  };
};

const driftOf = (stored, current, option) => {
  if (snapshotSame([stored], [current]).ok) return null;
  const was = new Set(stored.ids);
  const now = new Set(current.ids);
  const added = current.ids.filter((id) => !was.has(id)).length;
  const removed = stored.ids.filter((id) => !now.has(id)).length;
  if (added) return `вариант «${option}» появился ещё в ${added} ${plural(added, "конфигурации", "конфигурациях", "конфигурациях")}`;
  if (removed) return `вариант «${option}» пропал из ${removed} ${plural(removed, "конфигурации", "конфигураций", "конфигураций")}`;
  return `у варианта «${option}» другие удалённые конфигурации`;
};

// addOptions и renameOptions: варианты в acc.set.options, переписывание
// конфигураций — в acc.writes (после записи атрибута)
const attributeOptions = async (store, doc, args, { allowNoop, snapshot }, acc) => {
  Object.assign(acc.out, { added: [], renames: [], refs: [] });
  const add = args.addOptions ?? [];
  const pairsRaw = args.renameOptions ?? [];
  if (!isStrings(add)) return fail(400, "Неверное значение поля «addOptions»");
  if (!Array.isArray(pairsRaw) || !pairsRaw.every((p) => isStrings([p?.from, p?.to]))) {
    return fail(400, "Неверное значение поля «renameOptions»");
  }
  if (!add.length && !pairsRaw.length) return null;
  if (!OPTION_TYPES.has(doc.valueType)) return fail(400, `У атрибута «${doc.name}» нет вариантов`);

  const added = [...new Set(add.map(str))];
  const pairs = pairsRaw.map((p) => ({ from: str(p.from), to: str(p.to) }));
  if (added.some((v) => !v) || pairs.some((p) => !p.from || !p.to)) return fail(400, "Пустой вариант");
  const same = pairs.find((p) => p.from === p.to);
  if (same) return fail(400, `Вариант «${same.from}» переименовывается сам в себя`);
  for (const list of [[...added, ...pairs.map((p) => p.to)], pairs.map((p) => p.from)]) {
    const twice = list.find((v, i) => list.indexOf(v) !== i);
    if (twice) return fail(400, `Вариант «${twice}» указан дважды`);
  }

  const options = (doc.options ?? []).map((o) => ({ value: String(o.value), label: o.label ?? String(o.value) }));
  const has = (value) => options.some((o) => o.value === value);
  const taken = (value) => fail(409, `Вариант «${value}» уже есть у атрибута «${doc.name}»`);
  const fresh = [];
  for (const value of added) {
    if (!has(value)) fresh.push(value);
    else if (!allowNoop) return taken(value);
  }
  // pending — ещё не переименован; done — повтор применения: from уже нет, to есть
  const pending = [];
  const done = [];
  for (const pair of pairs) {
    if (has(pair.to)) {
      if (allowNoop && !has(pair.from)) done.push(pair);
      else return taken(pair.to);
    } else if (!has(pair.from)) {
      return fail(404, `Варианта «${pair.from}» нет у атрибута «${doc.name}»`);
    } else pending.push(pair);
  }

  const rows = pending.length || done.length ? await store.configValues(doc._id) : [];
  const storedOf = (option) =>
    (snapshot ?? []).find((entry) => entry?.option === option && String(entry.attributeId) === String(doc._id));
  const ids = [];
  for (const pair of pending) {
    const current = optionRefs(doc, rows, pair.from);
    if (snapshot !== undefined) {
      const stored = storedOf(pair.from);
      if (!stored) return fail(409, `${DRIFT}: нет снимка конфигураций для варианта «${pair.from}»`);
      const drift = driftOf(stored, current, pair.from);
      if (drift) return fail(409, `${DRIFT}: ${drift}`);
    }
    acc.out.refs.push(current);
    acc.out.renames.push({ ...pair, live: current.live, deleted: current.deleted });
    ids.push(...current.ids);
  }
  for (const pair of done) ids.push(...(storedOf(pair.from)?.ids ?? []));
  acc.out.added = fresh;

  if (fresh.length || pending.length) {
    const to = new Map(pending.map((p) => [p.from, p.to]));
    acc.set.options = [
      ...options.map((o) => (to.has(o.value) ? { value: to.get(o.value), label: to.get(o.value) } : o)),
      ...fresh.map((value) => ({ value, label: value })),
    ];
  }
  if (ids.length) {
    const map = new Map([...pending, ...done].map((p) => [p.from, p.to]));
    const byId = new Map(rows.map((row) => [String(row._id), row.value]));
    acc.writes.push(async (userId) => {
      for (const id of new Set(ids)) {
        const value = byId.get(id);
        if (value === undefined) continue;
        const next = renamed(doc.valueType, value, map);
        if (next !== value) await store.rewriteValue(id, doc._id, value, next, userId);
      }
    });
  }
  return null;
};

// --- значения конфигурации -----------------------------------------------------

// setValues/clearValues -> acc.set.values (весь список) и строки acc.out.values
const configurationValues = async (store, doc, args, _options, acc) => {
  if (doc.deletedAt) return fail(404, "Конфигурация удалена");
  acc.out.values = [];
  const sets = args.setValues ?? [];
  const clears = args.clearValues ?? [];
  if (!Array.isArray(sets)) return fail(400, "Неверное значение поля «setValues»");
  if (!isStrings(clears)) return fail(400, "Неверное значение поля «clearValues»");
  if (!sets.length && !clears.length) return null;
  const model = await store.get("model", doc.deviceModelId);
  if (!model || model.deletedAt) return fail(404, "Модель конфигурации удалена");

  const setCodes = sets.map((item) => str(item?.attribute));
  if (setCodes.some((code) => !code)) return fail(400, "У значения не указан атрибут");
  const codes = [...setCodes, ...clears.map(str)];
  const twice = codes.find((code, i) => codes.indexOf(code) !== i);
  if (twice) return fail(400, `Атрибут «${twice}» указан в значениях дважды`);
  const [attrs, linkedIds, type] = await Promise.all([
    store.attributesByCode(codes),
    store.linkedAttributeIds(model.deviceTypeId),
    store.get("type", model.deviceTypeId),
  ]);
  const byCode = new Map(attrs.map((attr) => [attr.code, attr]));
  const linked = new Set(linkedIds.map(String));

  let values = (doc.values ?? []).map((v) => ({ ...v }));
  const at = (attr) => values.find((v) => String(v.attributeId) === String(attr._id));
  const rows = [];
  const clear = (attr, field) => {
    const old = at(attr)?.value;
    if (!old) return;
    values = values.filter((v) => String(v.attributeId) !== String(attr._id));
    rows.push({ field, name: attr.name, value: null, before: formatSpecValue(attr, old) });
  };
  for (const [i, item] of sets.entries()) {
    const attr = byCode.get(setCodes[i]);
    if (!attr) return fail(400, `Атрибут «${setCodes[i]}» не найден`);
    // Скрытый выбрать нельзя; снять его значение (clearValues) — можно
    if (attr.isActive === false) return fail(400, `Атрибут «${attr.name}» скрыт`);
    if (!linked.has(String(attr._id))) return fail(400, `Атрибут «${attr.name}» не относится к типу «${type?.name ?? "—"}»`);
    const value = storedValue(attr, item.value);
    if (value === null) return fail(400, `Неверное значение атрибута «${attr.name}»`);
    if (!isValidValue(attr, value)) return fail(400, `Значение «${value}» не подходит атрибуту «${attr.name}»`);
    // Пустое значение — «не задано»: снять
    if (!value) {
      clear(attr, "setValues");
      continue;
    }
    const current = at(attr);
    if (current?.value === value) continue;
    rows.push({
      field: "setValues",
      name: attr.name,
      value: formatSpecValue(attr, value),
      before: current?.value ? formatSpecValue(attr, current.value) : EMPTY,
    });
    if (current) current.value = value;
    else values.push({ attributeId: attr._id, value });
  }
  for (const code of clears.map(str)) {
    const attr = byCode.get(code);
    if (!attr) return fail(400, `Атрибут «${code}» не найден`);
    clear(attr, "clearValues");
  }
  if (rows.length) acc.set.values = values;
  acc.out.values = rows;
  return null;
};

// --- детали сборки -------------------------------------------------------------

const partsKey = (parts) =>
  JSON.stringify(
    (parts ?? []).map((p) => [String(p.typeId), String(p.deviceModelId), p.configurationId ? String(p.configurationId) : null, p.quantity ?? 1]),
  );

const partsTitle = async (store, parts) => {
  if (!parts?.length) return "нет";
  const found = new Map((await store.find("model", parts.map((p) => String(p.deviceModelId)))).map((m) => [String(m._id), m.name]));
  return parts
    .map((p) => `${found.get(String(p.deviceModelId)) ?? "модель удалена"}${(p.quantity ?? 1) > 1 ? ` ×${p.quantity}` : ""}`)
    .join(", ");
};

// parts целиком — по правилам createBuild (слоты типа сборки, ссылки деталей)
const buildParts = async (store, doc, args, _options, acc) => {
  if (doc.deletedAt) return fail(404, "Сборка удалена");
  if (args.parts === undefined) return null;
  const fields = await store.buildFields(doc.deviceTypeId, { name: acc.next.name ?? doc.name, parts: args.parts });
  if (fields.error) return fail(fields.error.status ?? 400, fields.error.message);
  if (partsKey(fields.parts) === partsKey(doc.parts)) return null;
  acc.set.parts = fields.parts;
  acc.before.parts = await partsTitle(store, doc.parts);
  return null;
};

// Дополнения вида сверх полей EDITABLE: -> fail | null
const EXTRAS = { attribute: attributeOptions, configuration: configurationValues, build: buildParts };

const makePlan = (store) => async (kind, args = {}, options = {}) => {
  const { allowNoop = false } = options;
  const doc = await store.get(kind, args.id);
  if (!doc) return fail(404, "Запись не найдена");
  const diff = await diffFields(store, kind, EDITABLE[kind], args, doc);
  if (!diff.ok) return diff;
  const acc = { ...diff, out: {}, writes: [] };
  const extra = await EXTRAS[kind]?.(store, doc, args, options, acc);
  if (extra) return extra;
  const { set, next, before, out, writes } = acc;
  if (!Object.keys(set).length) {
    return allowNoop ? { ok: true, doc, set, before, out, writes } : fail(409, "Ничего не меняется: значения уже такие");
  }
  const ruled = await kindRules[kind]?.(store, doc, next);
  if (ruled) return ruled;
  if (next.name !== undefined && NAME_TAKEN[kind]) {
    const holder = await store.nameHolder(kind, next.name, doc._id);
    if (holder) {
      return fail(409, holder.isActive === false ? catalogSeed.hiddenNameTaken(holder.name) : NAME_TAKEN[kind](next.name));
    }
  }
  return { ok: true, doc, set, before, out, writes };
};

// --- связь тип↔атрибут ---------------------------------------------------------

const LINK_FIELDS = ["required", "order", "groupId"];

const linkOf = async (store, args) => {
  const [type, attr] = await Promise.all([store.get("type", args.type), store.get("attribute", args.attribute)]);
  if (!type) return fail(404, "Тип не найден");
  if (!attr) return fail(404, "Атрибут не найден");
  const link = await store.typeLink(type._id, attr._id);
  return { ok: true, type, attr, link, missing: fail(404, `Атрибут «${attr.name}» не привязан к типу «${type.name}»`) };
};

const planTypeAttribute = async (store, args = {}, { allowNoop = false } = {}) => {
  const found = await linkOf(store, args);
  if (!found.ok) return found;
  if (!found.link) return found.missing;
  const diff = await diffFields(store, "link", LINK_FIELDS, args, found.link);
  if (!diff.ok) return diff;
  // Снятая группа — «Без группы» (null), как у формы
  if (Object.hasOwn(diff.set, "groupId")) diff.set.groupId = diff.set.groupId ?? null;
  if (diff.next.groupId && !(await store.get("group", diff.next.groupId))) return fail(404, "Группа не найдена");
  if (!Object.keys(diff.set).length && !allowNoop) return fail(409, "Ничего не меняется: значения уже такие");
  return { ok: true, link: found.link, set: diff.set, before: diff.before };
};

// Снять атрибут с типа: не когда на связь опирается keySpec или значения
const planUnlink = async (store, args = {}, { allowNoop = false } = {}) => {
  const found = await linkOf(store, args);
  if (!found.ok) return found;
  const { type, attr, link } = found;
  if (!link) return allowNoop ? { ok: true, link: null } : found.missing;
  const owners = await store.keySpecOwners(type._id, attr._id);
  if (owners.length) {
    const names = owners.map((name) => `«${name}»`).join(", ");
    return fail(409, `Атрибут «${attr.name}» стоит в ключевых характеристиках типов ${names}: сначала уберите его оттуда`);
  }
  const count = await store.typeValueCount(type._id, attr._id);
  if (count > 0) {
    return fail(409, `У конфигураций моделей типа «${type.name}» есть значения атрибута «${attr.name}» (${count}): сначала уберите их`);
  }
  return { ok: true, link };
};

// Обёртка пары: исключение -> 500 (оригинал — в error для журнала), E11000 -> 409
const guarded = (failMessage, fn) => async (...params) => {
  try {
    return await fn(...params);
  } catch (error) {
    if (error?.code === 11000) return fail(409, "Такая запись уже есть в справочнике");
    return { ...fail(500, failMessage), error };
  }
};

/** Пары check/apply для каждого вида; store — подмена доступа к базе (тесты). */
const createCatalogEditOps = (store = liveStore()) => {
  const plan = makePlan(store);
  const ops = {};
  const KINDS = {
    vendor: "Vendor",
    supplier: "Supplier",
    model: "Model",
    type: "DeviceType",
    group: "Group",
    attribute: "Attribute",
    configuration: "Configuration",
    build: "Build",
  };
  for (const [kind, label] of Object.entries(KINDS)) {
    ops[`checkUpdate${label}`] = guarded(`Failed to check ${kind} update`, async (args, options) => {
      const planned = await plan(kind, args, options);
      return planned.ok ? { ok: true, before: planned.before, ...planned.out } : planned;
    });
    // При применении снимок обязателен: нет его — null (не «предложение»)
    ops[`applyUpdate${label}`] = guarded(`Failed to update ${kind}`, async (args, { userId, snapshot } = {}) => {
      const planned = await plan(kind, args, { allowNoop: true, snapshot: snapshot ?? null });
      if (!planned.ok) return planned;
      if (Object.keys(planned.set).length && !(await store.update(kind, args.id, planned.set, userId))) {
        return fail(404, "Запись не найдена");
      }
      for (const write of planned.writes) await write(userId);
      return { ok: true, id: planned.doc._id };
    });
  }

  // Связь — цель сверки: её правка после предложения — дрейф, а не тихая перезапись
  ops.checkUpdateTypeAttribute = guarded("Failed to check type attribute update", async (args, options) => {
    const planned = await planTypeAttribute(store, args, options);
    if (!planned.ok) return planned;
    const { _id, updatedAt } = planned.link;
    return { ok: true, before: planned.before, targets: [{ model: "DeviceTypeAttribute", id: _id, updatedAt: updatedAt ?? null }] };
  });
  ops.applyUpdateTypeAttribute = guarded("Failed to update type attribute", async (args, { userId } = {}) => {
    const planned = await planTypeAttribute(store, args, { allowNoop: true });
    if (!planned.ok) return planned;
    if (Object.keys(planned.set).length && !(await store.updateLink(planned.link._id, planned.set, userId))) {
      return fail(404, "Запись не найдена");
    }
    return { ok: true, id: planned.link._id };
  });
  ops.checkUnlinkAttribute = guarded("Failed to check attribute unlink", async (args, options) => {
    const planned = await planUnlink(store, args, options);
    return planned.ok ? { ok: true, before: {} } : planned;
  });
  ops.applyUnlinkAttribute = guarded("Failed to unlink attribute", async (args) => {
    const planned = await planUnlink(store, args, { allowNoop: true });
    if (!planned.ok) return planned;
    if (planned.link) await store.deleteLink(planned.link._id);
    return { ok: true, id: planned.link?._id ?? null };
  });
  return ops;
};

module.exports = { createCatalogEditOps, ...createCatalogEditOps() };
