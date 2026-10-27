const mongoose = require("mongoose");
const Vendor = require("../../models/inventory/vendor");
const Supplier = require("../../models/inventory/supplier");
const DeviceModel = require("../../models/inventory/deviceModel");
const DeviceType = require("../../models/inventory/deviceType");
const DeviceConfiguration = require("../../models/inventory/deviceConfiguration");
const DeviceAttribute = require("../../models/inventory/deviceAttribute");
const DeviceTypeAttribute = require("../../models/inventory/deviceTypeAttribute");
const DeviceBuild = require("../../models/inventory/deviceBuild");
const AttributeGroup = require("../../models/inventory/attributeGroup");
const {
  loadAssemblyType,
  buildFields,
} = require("../../controllers/inventory/deviceBuild");
const catalogSeed = require("./catalogSeed");
const { isValidValue } = require("./attributeValue");
const { formatSpecValue } = require("./assemblyKeySpecs");
const { hasForbiddenChars } = require("../mikrotik/changeRender");
const {
  agentConfigurationMode,
  liveConfigurations,
} = require("./modelConfigurations");

// Каталожные операции ИИ-агента: только добавление. Правила дублей и тексты
// отказов — как у обработчиков контроллеров (vendor, supplier, deviceModel,
// deviceConfiguration, deviceBuild), плюс проверки, которых форма не делает за
// человека: существование типа/вендора, связанность атрибута с типом модели,
// значение по типу атрибута.
//
// У каждого вида пара: check* (без записей) и create*; обе строятся из одного
// плана (plan*), запись делает только create*. Результат:
//   create* -> { ok:true, id } | { ok:false, status, message }
//   check*  -> { ok:true, text } | { ok:false, status, message, text }
// text — одна русская строка с именами, без id. Аргументы: (params, { userId }).

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const isId = (value) => typeof value === "string" && OBJECT_ID.test(value);

const fail = (status, message) => ({ ok: false, status, message });
const str = (value) => (typeof value === "string" ? value.trim() : "");

// Ошибка приведения/валидации Mongoose -> 400 с названием поля.
const validationFailure = (error) => {
  if (error?.name === "CastError") return fail(400, `Неверное значение поля «${error.path}»`);
  if (error?.name === "ValidationError") {
    const field = Object.keys(error.errors || {})[0];
    return fail(400, `Неверное значение поля «${field}»`);
  }
  return null;
};

// Исполнитель плана: check — validate без записи; иначе save. План может
// вернуть extra — документы, которые пишутся следом за doc (конфигурация новой
// модели, режим модели). E11000 -> 409, ошибка значения -> 400, остальное ->
// 500 (с error для журнала).
const execute = async (failMessage, check, plan) => {
  try {
    const planned = await plan();
    if (!planned.ok) return check ? { ...planned, text: "" } : planned;
    for (const doc of [planned.doc, ...(planned.extra ?? [])]) {
      if (check) await doc.validate();
      else await doc.save();
    }
    return check ? { ok: true, text: planned.text } : { ok: true, id: planned.doc._id };
  } catch (error) {
    const invalid = validationFailure(error);
    if (invalid) return check ? { ...invalid, text: "" } : invalid;
    const failure =
      error?.code === 11000
        ? fail(409, "Такая запись уже есть в справочнике")
        : { ...fail(500, failMessage), error };
    return check ? { ...failure, text: "" } : failure;
  }
};

const author = (userId) => (userId ? { createdBy: userId, updatedBy: userId } : {});

// --- вендор --------------------------------------------------------------------

const planVendor = async ({ name } = {}, { userId } = {}) => {
  const clean = str(name);
  if (!clean) return fail(400, "Укажите название вендора");
  if (await Vendor.findOne({ name: clean })) {
    return fail(409, `Vendor with name "${clean}" already exists`);
  }
  const doc = new Vendor({ name: clean, isMikrotikManagementEnabled: false, ...author(userId) });
  return { ok: true, doc, text: `Новый вендор «${clean}»` };
};

const createVendor = (params, options) =>
  execute("Failed to add vendor", false, () => planVendor(params, options));
const checkVendor = (params, options) =>
  execute("Failed to add vendor", true, () => planVendor(params, options));

// --- поставщик -----------------------------------------------------------------

const SUPPLIER_FIELDS = ["inn", "kpp", "website", "notes"];

const planSupplier = async (params = {}, { userId } = {}) => {
  const name = str(params.name);
  if (!name) return fail(400, "Укажите название поставщика");
  for (const field of SUPPLIER_FIELDS) {
    if (params[field] != null && typeof params[field] !== "string") {
      return fail(400, `Неверное значение поля «${field}»`);
    }
  }
  if (await Supplier.findOne({ name })) {
    return fail(409, `Поставщик «${name}» уже есть в справочнике`);
  }
  const doc = new Supplier({ name, ...author(userId) });
  // Как applyFields контроллера: пустое — не задано
  for (const field of SUPPLIER_FIELDS) doc[field] = str(params[field]) || undefined;
  const inn = str(params.inn);
  return { ok: true, doc, text: `Новый поставщик «${name}»${inn ? ` (ИНН ${inn})` : ""}` };
};

const createSupplier = (params, options) =>
  execute("Failed to add supplier", false, () => planSupplier(params, options));
const checkSupplier = (params, options) =>
  execute("Failed to add supplier", true, () => planSupplier(params, options));

// --- модель --------------------------------------------------------------------

const planModel = async (params = {}, { userId } = {}) => {
  const { deviceTypeId, vendorId } = params;
  const name = str(params.name);
  if (!name) return fail(400, "Укажите название модели");
  const type = isId(deviceTypeId) ? await DeviceType.findById(deviceTypeId).select("name").lean() : null;
  if (!type) return fail(400, "Тип устройства не найден");
  const vendor = isId(vendorId) ? await Vendor.findById(vendorId).select("name").lean() : null;
  if (!vendor) return fail(400, "Вендор не найден");
  if (await DeviceModel.findOne({ name, deletedAt: null })) {
    return fail(409, `Device model with name "${name}" already exists`);
  }
  const notes = str(params.notes) || undefined;
  const doc = new DeviceModel({
    deviceTypeId,
    vendorId,
    name,
    notes,
    compatibleWithModelIds: [],
    ...author(userId),
  });
  // Модель живёт с конфигурацией с первого дня (services/inventory/modelConfigurations)
  const configuration = new DeviceConfiguration({
    deviceModelId: doc._id,
    values: [],
    ...author(userId),
  });
  return {
    ok: true,
    doc,
    extra: [configuration],
    text: `Новая модель ${vendor.name} ${name} (${type.name})`,
  };
};

const createModel = (params, options) =>
  execute("Failed to add device model", false, () => planModel(params, options));
const checkModel = (params, options) =>
  execute("Failed to add device model", true, () => planModel(params, options));

// --- конфигурация --------------------------------------------------------------

// Значение, как его хранит конфигурация: строка; multiselect — JSON-массив
// строк (как serializeMultiValue формы). Массив допустим только multiselect.
// null — значение негодное (объект, массив не там и т. п.).
const storedValue = (attr, raw) => {
  if (raw == null) return "";
  if (Array.isArray(raw)) {
    if (attr.valueType !== "multiselect") return null;
    if (!raw.every((item) => typeof item === "string" || typeof item === "number")) return null;
    return raw.length ? JSON.stringify(raw.map(String)) : "";
  }
  if (typeof raw === "object") return null;
  return String(raw).trim();
};

const planConfiguration = async (params = {}, { userId } = {}) => {
  const { deviceModelId } = params;
  const name = str(params.name);
  if (!name) return fail(400, "Укажите название конфигурации");
  if (!Array.isArray(params.values ?? [])) return fail(400, "values должен быть массивом");
  const model = isId(deviceModelId) ? await DeviceModel.findById(deviceModelId).lean() : null;
  if (!model || model.deletedAt) {
    return fail(404, `Device model with id ${deviceModelId} not found`);
  }

  const values = (params.values ?? []).map((item) => ({
    code: str(item?.attribute),
    raw: item?.value,
  }));
  for (const { code } of values) if (!code) return fail(400, "У значения не указан атрибут");
  const codes = [...new Set(values.map((item) => item.code))];
  if (codes.length !== values.length) return fail(400, "Атрибут указан в значениях дважды");

  const [attrs, links, type, vendor] = await Promise.all([
    codes.length ? DeviceAttribute.find({ code: { $in: codes } }).lean() : [],
    DeviceTypeAttribute.find({ deviceTypeId: model.deviceTypeId }).select("attributeId").lean(),
    DeviceType.findById(model.deviceTypeId).select("name").lean(),
    Vendor.findById(model.vendorId).select("name").lean(),
  ]);
  const attrByCode = new Map(attrs.map((attr) => [attr.code, attr]));
  const linked = new Set(links.map((link) => String(link.attributeId)));

  const saved = [];
  const shown = [];
  for (const { code, raw } of values) {
    const attr = attrByCode.get(code);
    if (!attr) return fail(400, `Атрибут «${code}» не найден`);
    if (!linked.has(String(attr._id))) {
      return fail(400, `Атрибут «${attr.name}» не относится к типу «${type?.name ?? "—"}»`);
    }
    const value = storedValue(attr, raw);
    if (value === null) return fail(400, `Неверное значение атрибута «${attr.name}»`);
    if (!isValidValue(attr, value)) {
      return fail(400, `Значение «${value}» не подходит атрибуту «${attr.name}»`);
    }
    // Пустое значение — «не задано»: не пишем
    if (!value) continue;
    saved.push({ attributeId: attr._id, value });
    shown.push(`${attr.name} ${formatSpecValue(attr, value)}`);
  }

  const modelTitle = [vendor?.name, model.name].filter(Boolean).join(" ");
  const shownText = shown.length ? `: ${shown.join(", ")}` : "";
  const description = str(params.description) || undefined;

  // Единственная пустая конфигурация вне режима нескольких — это характеристики
  // модели: заполняются они, второй не появляется
  const configs = await liveConfigurations(deviceModelId);
  const mode = agentConfigurationMode(model, configs);
  if (mode === "fill") {
    const doc = configs[0];
    Object.assign(doc, { name, description, values: saved });
    if (userId) doc.updatedBy = userId;
    return { ok: true, doc, text: `Характеристики модели ${modelTitle}${shownText}` };
  }

  const doc = new DeviceConfiguration({
    deviceModelId,
    name,
    description,
    values: saved,
    ...author(userId),
  });
  // Вторая конфигурация — модель переходит в режим нескольких
  const extra = [];
  if (mode === "add" && !model.multiConfig) {
    const switched = DeviceModel.hydrate(model);
    switched.multiConfig = true;
    if (userId) switched.updatedBy = userId;
    extra.push(switched);
  }
  return {
    ok: true,
    doc,
    extra,
    text: `Новая конфигурация «${name}» для ${modelTitle}${shownText}`,
  };
};

const createConfiguration = (params, options) =>
  execute("Failed to add device configuration", false, () => planConfiguration(params, options));
const checkConfiguration = (params, options) =>
  execute("Failed to add device configuration", true, () => planConfiguration(params, options));

// --- сборка --------------------------------------------------------------------

// parts здесь — внутренний вид parseBuildParts: { typeId, deviceModelId,
// configurationId?, quantity? } (имена полей операции переводит вызывающий).
const planBuild = async (params = {}, { userId } = {}) => {
  const loaded = await loadAssemblyType(params.deviceTypeId);
  if (loaded.error) return fail(loaded.error.statusCode, loaded.error.message);
  if (loaded.slots.length === 0) return fail(400, "У типа не заданы комплектующие");
  // Имя, детали и их ссылки — общая с контроллером buildFields
  const fields = await buildFields(params, loaded.slots);
  if (fields.error) return fail(fields.error.statusCode, fields.error.message);
  const { name, notes, parts } = fields;

  const models = await DeviceModel.find({ _id: { $in: parts.map((p) => p.deviceModelId) } })
    .select("name vendorId")
    .populate("vendorId", "name")
    .lean();
  const titleById = new Map(
    models.map((model) => [
      String(model._id),
      [model.vendorId?.name, model.name].filter(Boolean).join(" "),
    ]),
  );
  const shown = parts.map((part) => {
    const title = titleById.get(String(part.deviceModelId)) ?? "—";
    return part.quantity > 1 ? `${title} ×${part.quantity}` : title;
  });

  const doc = new DeviceBuild({
    name,
    deviceTypeId: loaded.deviceType._id,
    parts,
    notes,
    ...author(userId),
  });
  return {
    ok: true,
    doc,
    text:
      `Новая сборка «${name}» (${loaded.deviceType.name})` + (shown.length ? `: ${shown.join(", ")}` : ""),
  };
};

const createBuild = (params, options) =>
  execute("Failed to create device build", false, () => planBuild(params, options));
const checkBuild = (params, options) =>
  execute("Failed to create device build", true, () => planBuild(params, options));

// --- каталог (seed-формат) -----------------------------------------------------

const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const CODE_RE = /^[a-z][a-z0-9_]{0,47}$/;
const RESERVED_KEYS = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "tostring",
  "valueof",
  "hasownproperty",
]);
const VALUE_TYPES = ["string", "number", "boolean", "select", "multiselect", "text"];
const FLAGS = ["isComponent", "isConsumable", "isPeripheral"];
const LIMITS = { groups: 30, types: 30, attributes: 100, typeAttributes: 60, options: 100, slots: 30, keySpecs: 60 };
const MAX_TEXT = 100;
const MAX_REASONS = 30;

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value, max = MAX_TEXT) => typeof value === "string" && value.trim() !== "" && value.length <= max;

// Места записи каталога (вглубь, ключи объектов тоже), где строка несёт
// перевод строки, управляющий, невидимый или bidi-символ: такие строки
// подделали бы строки сообщения на утверждение. -> ["name", "options[1].label", …]
const forbiddenPaths = (value, path = "") => {
  if (typeof value === "string") return hasForbiddenChars(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((item, i) => forbiddenPaths(item, `${path}[${i}]`));
  if (!isPlain(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const at = path ? `${path}.${key}` : key;
    return hasForbiddenChars(key) ? [path || "ключ"] : forbiddenPaths(item, at);
  });
};

/**
 * Структура каталога из недоверенного JSON. Не пишет и не ходит в базу; все
 * причины сразу. Ссылки (`attr`, `group`, `type` в слотах) — только на ключи
 * самого каталога, как их понимает planCatalog; неизвестная ссылка — причина,
 * а не молчаливое «ничего». -> { ok:true } | { ok:false, status:400, message }
 */
const validateCatalog = (catalog) => {
  if (!isPlain(catalog)) return fail(400, "Каталог должен быть объектом");
  const reasons = [];
  const bad = (text) => reasons.push(text);

  const listOf = (field) => {
    const list = catalog[field] ?? [];
    if (!Array.isArray(list)) {
      bad(`${field} должен быть массивом`);
      return [];
    }
    if (list.length > LIMITS[field]) {
      bad(`${field}: не больше ${LIMITS[field]} записей`);
      return [];
    }
    return list;
  };
  const groups = listOf("groups");
  const types = listOf("types");
  const attributes = listOf("attributes");

  // Ключ: формат, запретные имена, уникальность в своём списке
  const keysOf = (list, label) => {
    const seen = new Set();
    list.forEach((entry, index) => {
      const where = `${label} №${index + 1}`;
      if (!isPlain(entry)) return bad(`${where}: должен быть объектом`);
      const { key } = entry;
      if (typeof key !== "string" || !KEY_RE.test(key)) {
        return bad(`${where}: key должен быть вида ^[a-z][a-z0-9_]{0,31}$`);
      }
      if (RESERVED_KEYS.has(key.toLowerCase())) return bad(`${where}: key «${key}» зарезервирован`);
      if (seen.has(key)) return bad(`${where}: key «${key}» повторяется`);
      seen.add(key);
    });
    return seen;
  };
  const groupKeys = keysOf(groups, "группа");
  const typeKeys = keysOf(types, "тип");
  const attrKeys = keysOf(attributes, "атрибут");
  // Чужой key в причине — только если он годный (без переводов строк и т. п.)
  const at = (entry, label) => (isPlain(entry) && typeof entry.key === "string" && KEY_RE.test(entry.key) ? `${label} «${entry.key}»` : label);

  // Недопустимые символы в любой строке записи — имена, варианты, единицы,
  // ссылки на ключи: причина на каждое поле
  for (const [list, label] of [[groups, "группа"], [types, "тип"], [attributes, "атрибут"]]) {
    list.forEach((entry, index) => {
      if (!isPlain(entry)) return;
      const where = KEY_RE.test(entry.key ?? "") ? at(entry, label) : `${label} №${index + 1}`;
      for (const path of forbiddenPaths(entry)) bad(`${where}: «${path}» содержит недопустимые символы`);
    });
  }

  groups.forEach((group) => {
    if (!isPlain(group)) return;
    const where = at(group, "группа");
    if (!isText(group.name)) bad(`${where}: name — непустая строка до ${MAX_TEXT} символов`);
    if (group.order !== undefined && !(Number.isInteger(group.order) && group.order >= 0 && group.order < 1000)) {
      bad(`${where}: order — целое число от 0`);
    }
  });

  attributes.forEach((attr) => {
    if (!isPlain(attr)) return;
    const where = at(attr, "атрибут");
    if (!isText(attr.name)) bad(`${where}: name — непустая строка до ${MAX_TEXT} символов`);
    if (typeof attr.code !== "string" || !CODE_RE.test(attr.code)) {
      bad(`${where}: code должен быть вида ^[a-z][a-z0-9_]{0,47}$`);
    }
    if (!VALUE_TYPES.includes(attr.valueType)) {
      bad(`${where}: valueType — одно из ${VALUE_TYPES.join(", ")}`);
    }
    if (attr.unit !== undefined && !(typeof attr.unit === "string" && attr.unit.length <= 20)) {
      bad(`${where}: unit — строка до 20 символов`);
    }
    const options = attr.options ?? [];
    if (!Array.isArray(options) || options.length > LIMITS.options) {
      bad(`${where}: options — массив до ${LIMITS.options} вариантов`);
    } else {
      options.forEach((option, index) => {
        if (typeof option === "string") {
          if (!isText(option)) bad(`${where}: вариант №${index + 1} — непустая строка до ${MAX_TEXT} символов`);
        } else if (!isPlain(option) || !isText(option.value)) {
          bad(`${where}: вариант №${index + 1} — строка или { value, label? }`);
        } else if (option.label !== undefined && !(typeof option.label === "string" && option.label.length <= MAX_TEXT)) {
          bad(`${where}: вариант №${index + 1}: label — строка до ${MAX_TEXT} символов`);
        }
      });
      if ((attr.valueType === "select" || attr.valueType === "multiselect") && options.length === 0) {
        bad(`${where}: для ${attr.valueType} нужен хотя бы один вариант`);
      }
    }
  });

  types.forEach((type) => {
    if (!isPlain(type)) return;
    const where = at(type, "тип");
    if (!isText(type.name)) bad(`${where}: name — непустая строка до ${MAX_TEXT} символов`);
    if (type.flags !== undefined) {
      if (!isPlain(type.flags) || Object.entries(type.flags).some(([k, v]) => !FLAGS.includes(k) || typeof v !== "boolean")) {
        bad(`${where}: flags — только ${FLAGS.join(", ")} со значением true/false`);
      }
    }
    const items = type.attributes ?? [];
    if (!Array.isArray(items) || items.length > LIMITS.typeAttributes) {
      bad(`${where}: attributes — массив до ${LIMITS.typeAttributes} записей`);
    } else {
      items.forEach((item, index) => {
        const line = `${where}: атрибут №${index + 1}`;
        if (!isPlain(item)) return bad(`${line} должен быть объектом`);
        if (typeof item.attr !== "string" || !attrKeys.has(item.attr)) {
          bad(`${line}: attr «${item.attr}» не среди атрибутов каталога`);
        }
        if (item.group != null && (typeof item.group !== "string" || !groupKeys.has(item.group))) {
          bad(`${line}: group «${item.group}» не среди групп каталога`);
        }
        if (item.required !== undefined && typeof item.required !== "boolean") {
          bad(`${line}: required — true/false`);
        }
      });
    }
    if (type.assembly === undefined) return;
    const assembly = type.assembly;
    if (!isPlain(assembly)) return bad(`${where}: assembly должен быть объектом`);
    const slots = assembly.slots ?? [];
    const keySpecs = assembly.keySpecs ?? [];
    if (!Array.isArray(slots) || slots.length > LIMITS.slots) {
      bad(`${where}: assembly.slots — массив до ${LIMITS.slots} слотов`);
    } else {
      slots.forEach((slot, index) => {
        const line = `${where}: слот №${index + 1}`;
        if (!isPlain(slot)) return bad(`${line} должен быть объектом`);
        if (typeof slot.type !== "string" || !typeKeys.has(slot.type)) {
          bad(`${line}: type «${slot.type}» не среди типов каталога`);
        }
        for (const flag of ["required", "multiple"]) {
          if (slot[flag] !== undefined && typeof slot[flag] !== "boolean") bad(`${line}: ${flag} — true/false`);
        }
      });
    }
    if (!Array.isArray(keySpecs) || keySpecs.length > LIMITS.keySpecs) {
      bad(`${where}: assembly.keySpecs — массив до ${LIMITS.keySpecs} записей`);
    } else {
      keySpecs.forEach((spec, index) => {
        const line = `${where}: ключевая характеристика №${index + 1}`;
        if (!isPlain(spec)) return bad(`${line} должна быть объектом`);
        if (typeof spec.type !== "string" || !typeKeys.has(spec.type)) {
          bad(`${line}: type «${spec.type}» не среди типов каталога`);
        }
        if (!["model", "attribute"].includes(spec.source)) bad(`${line}: source — model или attribute`);
        if (!["first", "sum", "list"].includes(spec.aggregate)) bad(`${line}: aggregate — first, sum или list`);
        if (spec.source === "attribute" && (typeof spec.attr !== "string" || !attrKeys.has(spec.attr))) {
          bad(`${line}: attr «${spec.attr}» не среди атрибутов каталога`);
        }
      });
    }
  });

  if (!reasons.length) return { ok: true };
  const shown = reasons.slice(0, MAX_REASONS);
  if (reasons.length > shown.length) shown.push(`…и ещё ${reasons.length - shown.length}`);
  return fail(400, `Каталог не принят: ${shown.join("; ")}`);
};

const normalizeCatalog = (catalog) => ({
  groups: catalog.groups ?? [],
  types: catalog.types ?? [],
  attributes: catalog.attributes ?? [],
});

const NOTHING_TO_DO = "Каталог не меняется — операция не нужна";

// Что план создаст или дополнит (без «подхвачено» и предупреждений)
const planHasWork = (plan) =>
  Object.values(plan.create).some((list) => list.length) ||
  Object.values(plan.update).some((list) => list.length);

// Документы, которые создал бы apply, — на validate (id связей подставные):
// то, что отвергнет запись (например тип значения), падает уже в check.
const validatePlanned = async (plan) => {
  const placeholder = () => new mongoose.Types.ObjectId();
  const docs = [
    ...plan.create.groups.map((g) => new AttributeGroup({ name: g.name, order: g.order })),
    ...plan.create.types.map((t) => new DeviceType({ name: t.name, ...t.flags })),
    ...plan.create.attributes.map(({ key: _key, ...fields }) => new DeviceAttribute(fields)),
    ...plan.create.links.map(
      (l) =>
        new DeviceTypeAttribute({
          deviceTypeId: placeholder(),
          attributeId: placeholder(),
          groupId: null,
          required: l.required,
          order: l.order,
        }),
    ),
  ];
  for (const doc of docs) await doc.validate();
};

// allowNoop: при применении каталог, где всё уже есть, — не отказ (между
// предложением и утверждением записи могли появиться); отказ — при предложении.
const checkCatalogPatch = async (catalog, { allowNoop = false } = {}) => {
  const valid = validateCatalog(catalog);
  if (!valid.ok) return { ...valid, text: "" };
  try {
    const normalized = normalizeCatalog(catalog);
    const plan = catalogSeed.planCatalog(normalized, await catalogSeed.loadExisting());
    if (!allowNoop && !planHasWork(plan)) return { ...fail(400, NOTHING_TO_DO), text: "" };
    await validatePlanned(plan);
    const lines = catalogSeed.describePlan(plan, normalized);
    return { ok: true, lines, text: lines.join("\n") };
  } catch (error) {
    const invalid = validationFailure(error);
    if (invalid) return { ...invalid, text: "" };
    return { ...fail(500, "Failed to plan catalog"), text: "", error };
  }
};

// Результат: { ok:true, ids, created, updated, warnings } | { ok:false, status, message }.
// Всё уже есть — тоже ok: ids подхваченного нужны ссылкам следующих операций.
const applyCatalogPatch = async (catalog, { userId } = {}) => {
  const valid = validateCatalog(catalog);
  if (!valid.ok) return valid;
  try {
    const result = await catalogSeed.applyCatalog(normalizeCatalog(catalog), { userId });
    return { ok: true, ...result };
  } catch (error) {
    const invalid = validationFailure(error);
    if (invalid) return invalid;
    if (error?.code === 11000) return fail(409, "Такая запись уже есть в справочнике");
    // Созданное откачено; уже дописанные варианты откатить нельзя
    const note = error?.optionsPushed ? "; часть вариантов могла быть добавлена" : "";
    return { ...fail(500, `Failed to apply catalog${note}`), error };
  }
};

module.exports = {
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
};
