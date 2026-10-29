// Поиск ссылок на запись справочника: кто указывает на модель, тип, атрибут,
// вендора, поставщика, группу или конфигурацию. Нужен слиянию и скрытию:
// снимок id при предложении, счётчики для текста, сверка дрейфа при применении.
// Удалённые (deletedAt) считаются отдельно: слияние их тоже переносит,
// а скрытие отказывает только из-за живых.
// Значения select/multiselect в конфигурациях хранят текст варианта, не id, —
// ссылками не являются. Мёртвые поля (DeviceType.configurationIds,
// DeviceTypeAttribute.extendableFromIds, DeviceConfigurationRecommendation) не ищем.
//
// Единственная связь с БД — store.query(model, path, kind, id) ->
// [{ _id, deletedAt? }]; боевой store ниже, без юнит-тестов.

// noun: [1, 2–4, 5+]; adj — «новое/новая/новый» в единственном числе;
// line — подпись в строке счётчика (по умолчанию «<label>: N»)
const VERB_OF = { новое: "появилось", новая: "появилась", новый: "появился" };
const ref = (model, path, kind, softDelete, countLabel, noun, adj, line) => ({
  model, path, kind, softDelete, countLabel, noun, adj, ...(line ? { line } : {}),
});
const DEVICE = ["устройство", "устройства", "устройств"];
const CONFIG = ["конфигурация", "конфигурации", "конфигураций"];
const BUILD = ["сборка", "сборки", "сборок"];
const MODEL = ["модель", "модели", "моделей"];
const TYPE = ["тип", "типа", "типов"];
const LINK = ["связь", "связи", "связей"];
const SLOT = ["слот", "слота", "слотов"];
const SPEC = ["характеристика", "характеристики", "характеристик"];
const VALUE = ["значение", "значения", "значений"];
const RULE = ["правило помещений", "правила помещений", "правил помещений"];

const deep = (o) => Object.values(o).forEach((v) => Object.freeze(v));
const REF_TABLE = {
  DeviceModel: [
    ref("ClientDevice", "deviceModelId", "single", true, "устройств", DEVICE, "новое"),
    ref("DeviceConfiguration", "deviceModelId", "single", true, "конфигураций", CONFIG, "новая"),
    ref("DeviceBuild", "parts.deviceModelId", "subdoc", true, "сборок", BUILD, "новая"),
    ref("DeviceModel", "compatibleWithModelIds", "array", true, "совместимость", MODEL, "новая",
      (n) => `совместимость: у ${n} ${plural(n, "модели", "моделей", "моделей")}`),
  ],
  DeviceType: [
    ref("DeviceModel", "deviceTypeId", "single", true, "моделей", MODEL, "новая"),
    ref("ClientDevice", "deviceTypeId", "single", true, "устройств", DEVICE, "новое"),
    ref("DeviceBuild", "deviceTypeId", "single", true, "сборок", BUILD, "новая"),
    ref("DeviceBuild", "parts.typeId", "subdoc", true, "сборок", BUILD, "новая"),
    ref("DeviceType", "attachableToTypeIds", "array", false, "типов", TYPE, "новый"),
    ref("DeviceType", "assembly.slots.typeId", "subdoc", false, "слотов", SLOT, "новый"),
    ref("DeviceType", "assembly.keySpecs.typeId", "subdoc", false, "характеристик", SPEC, "новая"),
    ref("DeviceTypeAttribute", "deviceTypeId", "single", false, "связей", LINK, "новая"),
    ref("Location", "responsibilityRules.deviceTypeOverrides.deviceType", "subdoc", false, "правил помещений", RULE, "новое"),
  ],
  DeviceAttribute: [
    ref("DeviceTypeAttribute", "attributeId", "single", false, "связей", LINK, "новая"),
    ref("DeviceConfiguration", "values.attributeId", "subdoc", true, "значений", VALUE, "новое"),
    ref("DeviceType", "assembly.keySpecs.attributeId", "subdoc", false, "характеристик", SPEC, "новая"),
  ],
  Vendor: [ref("DeviceModel", "vendorId", "single", true, "моделей", MODEL, "новая")],
  Supplier: [ref("ClientDevice", "supplierId", "single", true, "устройств", DEVICE, "новое")],
  AttributeGroup: [ref("DeviceTypeAttribute", "groupId", "single", false, "связей", LINK, "новая")],
  DeviceConfiguration: [
    ref("ClientDevice", "configurationId", "single", true, "устройств", DEVICE, "новое"),
    ref("DeviceBuild", "parts.configurationId", "subdoc", true, "сборок", BUILD, "новая"),
  ],
};
deep(REF_TABLE);
Object.freeze(REF_TABLE);

// Русское число: plural(n, «модель», «модели», «моделей»); общий для правок и слияний
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const key = (r) => `${r.model}:${r.path}`;

// Строка счётчика: «устройств: 12 и 1 удалённое». Пустые пути пропускаем.
const countLines = (refs) =>
  refs
    .filter((r) => r.live + r.deleted > 0)
    .map((r) => {
      const meta = Object.values(REF_TABLE).flat().find((t) => key(t) === key(r));
      // «совместимость: у N моделей» — особая форма
      const head = meta?.line ? meta.line(r.live) : `${meta?.countLabel ?? r.model}: ${r.live}`;
      if (!r.deleted) return head;
      const word = plural(r.deleted, "удалённое", "удалённых", "удалённых");
      return `${head} и ${r.deleted} ${word}`;
    });

const createCatalogRefs = ({ store }) => {
  const find = async (entity, id) => {
    const table = REF_TABLE[entity];
    if (!table) throw new Error(`Неизвестная сущность справочника: ${entity}`);
    const out = [];
    for (const t of table) {
      const hits = await store.query(t.model, t.path, t.kind, id);
      if (!hits.length) continue;
      const rows = hits.map((h) => ({ id: String(h._id), deleted: t.softDelete && !!h.deletedAt }));
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const deletedIds = rows.filter((r) => r.deleted).map((r) => r.id);
      out.push({
        model: t.model,
        path: t.path,
        ids: rows.map((r) => r.id),
        live: rows.length - deletedIds.length,
        deleted: deletedIds.length,
        deletedIds,
      });
    }
    return out;
  };

  // Сверка снимка (a) с текущим (b): { ok, diff } — diff для текста дрейфа
  const same = (a, b, { entityLabel = "запись", name } = {}) => {
    const subject = name ? `на ${entityLabel} «${name}»` : `на ${entityLabel}`;
    const byKey = (refs) => new Map(refs.map((r) => [key(r), r]));
    const am = byKey(a), bm = byKey(b);
    const diff = [];
    for (const k of [...new Set([...am.keys(), ...bm.keys()])]) {
      const ra = am.get(k), rb = bm.get(k);
      const idsA = new Set(ra?.ids ?? []), idsB = new Set(rb?.ids ?? []);
      const added = [...idsB].filter((i) => !idsA.has(i)).length;
      const removed = [...idsA].filter((i) => !idsB.has(i)).length;
      const meta = Object.values(REF_TABLE).flat().find((t) => key(t) === k);
      const nounForms = meta?.noun ?? ["запись", "записи", "записей"];
      const noun = (n) => `${n} ${plural(n, ...nounForms)}`;
      if (added) {
        const adj = added === 1 ? (meta?.adj ?? "новая") : "новых";
        // глагол — по роду при единице: «появилась 1 новая связь», «появился 1 новый …»
        const verb = added === 1 ? (VERB_OF[adj] ?? "появилось") : "появилось";
        diff.push(`${subject} ${verb} ${added} ${adj} ${plural(added, ...nounForms)}`);
      }
      if (removed) diff.push(`${subject} стало меньше: ${noun(removed)}`);
      if (!added && !removed) {
        const dA = ra?.deletedIds ?? [], dB = rb?.deletedIds ?? [];
        if (dA.join() !== dB.join()) {
          diff.push(`${subject} ссылаются другие удалённые записи: было ${dA.length}, стало ${dB.length}`);
        }
      }
    }
    return { ok: diff.length === 0, diff };
  };

  return { find, same };
};

// Боевое хранилище: ленивые require, как в changeOps/names.js
const MODELS = {
  ClientDevice: "../../models/inventory/clientDevice",
  DeviceModel: "../../models/inventory/deviceModel",
  DeviceType: "../../models/inventory/deviceType",
  DeviceConfiguration: "../../models/inventory/deviceConfiguration",
  DeviceBuild: "../../models/inventory/deviceBuild",
  DeviceTypeAttribute: "../../models/inventory/deviceTypeAttribute",
  Location: "../../models/inventory/location",
};
const liveStore = {
  // single/array/subdoc — один и тот же запрос по пути: Mongo сам заходит в массивы
  query: async (model, path, _kind, id) => {
    const Model = require(MODELS[model]);
    return Model.find({ [path]: id }).select("_id deletedAt").lean();
  },
};

module.exports = { REF_TABLE, createCatalogRefs, countLines, liveStore, plural };
