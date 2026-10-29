/**
 * Помощник сидов каталога инвентаря: группы атрибутов, типы устройств,
 * атрибуты и их связки с типами.
 *
 * Правило сида — только добавлять. Существующее подхватывается: группы и
 * типы — по имени без учёта регистра, атрибуты — по коду ИЛИ имени без учёта
 * регистра (на базах висит устаревший точный уникальный индекс `name_1`, так
 * что атрибут с тем же именем создавать нельзя), связки — по паре (тип,
 * атрибут). Чужие поля не перезаписываются, кроме трёх случаев:
 *   • у select/multiselect дописываются недостающие варианты;
 *   • связка без группы получает группу из каталога;
 *   • подхваченный тип, который в каталоге — комплектующая, получает
 *     `isComponent: true`.
 * Расхождение типа значения у подхваченного атрибута — предупреждение,
 * атрибут всё равно подхватывается.
 *
 * «Своя сборка» (`assembly` у типа) ставится целиком — слоты, ключевые
 * характеристики и `enabled: true` — только типу, у которого слотов ещё нет
 * (новому или подхваченному); настроенную владельцем сборку сид не трогает и
 * не предупреждает. Записи сборки проверяются так же, как их проверяет API:
 * в слоте — только комплектующая и не дважды, ключевая характеристика — по
 * типу из слотов, атрибут — связанный с этим типом в каталоге, сумма — только
 * по числовому (по типу значения подхваченного атрибута). Негодная запись —
 * предупреждение и пропуск.
 *
 * `pickUpOnly` — только подхват: ничего не создаётся (групп, типов, атрибутов,
 * связок) и не дописывается (варианты, группы связок, флаг комплектующей).
 * Ненайденный тип или атрибут, несуществующая связка — предупреждение, и
 * зависящие от них слоты и ключевые характеристики выпадают. Не найден сам
 * собираемый тип — предупреждение, ничего не пишется.
 *
 * Имя (или код атрибута) держит скрытая запись (isActive:false): подхватить её
 * нельзя. `hiddenClash` — что тогда: "warn" (по умолчанию, сиды в любом режиме) —
 * предупреждение и пропуск записи каталога: ничего не подхвачено и не создано,
 * связки и сборка пропущенного выпадают, пропущенная группа у связки — без
 * группы; "refuse" (путь агента, catalogOps) — отказ: план несёт conflicts,
 * applyCatalog бросает до записи.
 *
 * Каталог:
 *   { groups:     [{ key, name, order }],
 *     types:      [{ key, name, flags?, attributes: [{ attr, group, required? }],
 *                    assembly?: { slots: [{ type, required?, multiple? }],
 *                                 keySpecs: [{ type, source, attr?, aggregate }] } }],
 *     attributes: [{ key, code, name, valueType, unit?, options? }] }
 * `attr`/`group`/`type` — ключи из соседних списков; `group: null` — без
 * группы. `source` — "model" | "attribute" (тогда нужен `attr`), `aggregate` —
 * "first" | "sum" | "list". Вариант select можно задать строкой — это и
 * значение, и подпись.
 */
const AttributeGroup = require("../../models/inventory/attributeGroup");
const DeviceType = require("../../models/inventory/deviceType");
const DeviceAttribute = require("../../models/inventory/deviceAttribute");
const DeviceTypeAttribute = require("../../models/inventory/deviceTypeAttribute");
const { uniqueAttributeCode } = require("../attributeCode");

const CHOICE_TYPES = new Set(["select", "multiselect"]);
const TYPE_FLAGS = ["isComponent", "isConsumable", "isPeripheral"];
const KEY_SPEC_SOURCES = ["model", "attribute"];
const KEY_SPEC_AGGREGATES = ["first", "sum", "list"];

const fold = (value) => String(value ?? "").trim().toLocaleLowerCase("ru");
const idKey = (id) => String(id);
const maxOrder = (rows) =>
  rows.reduce((max, row) => Math.max(max, Number(row.order) || 0), -Infinity);

const normalizeOption = (option) =>
  typeof option === "string"
    ? { value: option, label: option }
    : { value: option.value, label: option.label ?? option.value };

/** Индекс «свёрнутое имя → документ»; первый выигрывает. */
const byFolded = (rows, field) => {
  const index = new Map();
  for (const row of rows) {
    const key = fold(row[field]);
    if (key && !index.has(key)) index.set(key, row);
  }
  return index;
};

/**
 * Слоты и ключевые характеристики одного типа на ключах каталога. Негодные
 * записи — в `warnings` и мимо (правила те же, что у API сборки).
 */
const planAssembly = (type, { componentTypeKeys, attrKeysByType, valueTypeByKey, attrKeys, warnings }) => {
  const warn = (text) => warnings.push(`каталог: сборка «${type.name}»: ${text}`);
  const slots = [];
  const slotKeys = new Set();
  for (const slot of type.assembly.slots || []) {
    if (!attrKeysByType.has(slot.type)) {
      warn(`неизвестный тип слота ${slot.type}`);
      continue;
    }
    if (!componentTypeKeys.has(slot.type)) {
      warn(`тип ${slot.type} не комплектующая — в слот нельзя`);
      continue;
    }
    if (slotKeys.has(slot.type)) {
      warn(`слот ${slot.type} повторяется`);
      continue;
    }
    slotKeys.add(slot.type);
    slots.push({
      typeKey: slot.type,
      required: slot.required === true,
      multiple: slot.multiple === true,
    });
  }

  const keySpecs = [];
  for (const spec of type.assembly.keySpecs || []) {
    const label = `ключевая характеристика ${spec.type}/${spec.attr ?? spec.source}`;
    if (!slotKeys.has(spec.type)) {
      warn(`${label}: тип не среди слотов`);
      continue;
    }
    if (!KEY_SPEC_SOURCES.includes(spec.source)) {
      warn(`${label}: неверный источник ${spec.source}`);
      continue;
    }
    if (!KEY_SPEC_AGGREGATES.includes(spec.aggregate)) {
      warn(`${label}: неверное сведение ${spec.aggregate}`);
      continue;
    }
    let attrKey = null;
    if (spec.source === "attribute") {
      if (!attrKeys.has(spec.attr)) {
        warn(`${label}: неизвестный атрибут`);
        continue;
      }
      if (!attrKeysByType.get(spec.type).has(spec.attr)) {
        warn(`${label}: атрибут не связан с типом слота`);
        continue;
      }
      if (spec.aggregate === "sum" && valueTypeByKey.get(spec.attr) !== "number") {
        warn(`${label}: сумма возможна только по числовому атрибуту`);
        continue;
      }
      attrKey = spec.attr;
    }
    keySpecs.push({ typeKey: spec.type, source: spec.source, attrKey, aggregate: spec.aggregate });
  }

  return { enabled: true, slots, keySpecs };
};

/**
 * Чистый план: что создать, что дописать, о чём предупредить. `pickUpOnly` —
 * см. шапку модуля. `existing` —
 * лёгкие выборки из базы: groups {_id,name,order}, types {_id,name,
 * isComponent,assembly.slots}, attributes {_id,code,name,valueType,options}, links
 * {_id,deviceTypeId,attributeId,groupId,order}. `matched` — ключ каталога →
 * `_id` подхваченного документа.
 */
// Отказ для имени, которое держит скрытая запись: подхватить её нельзя, создать
// такую же — тоже (уникальный индекс), поэтому человеку остаётся вернуть её
const hiddenNameTaken = (name) =>
  `имя занято скрытой записью «${name}» — верните её (isActive) или выберите другое имя`;
const isHidden = (doc) => doc?.isActive === false;

const planCatalog = (catalog, existing, { pickUpOnly = false, hiddenClash = "warn" } = {}) => {
  const warnings = [];
  // Имена скрытых записей, с которыми столкнулся каталог (по порядку, без повторов)
  const conflicts = [];
  // Ключи каталога, пропущенные из-за скрытого имени (сид): от них зависящее выпадает
  const skipped = { groups: new Set(), types: new Set(), attributes: new Set() };
  // Сиды не должны падать — предупреждение; путь агента — отказ
  const clash = (list, key, doc) => {
    const text = hiddenNameTaken(doc.name);
    skipped[list].add(key);
    if (hiddenClash !== "refuse") warnings.push(`${pickUpOnly ? "подхват" : "каталог"}: ${text}`);
    else if (!conflicts.includes(text)) conflicts.push(text);
  };
  const create = { groups: [], types: [], attributes: [], links: [] };
  const update = { attributeOptions: [], linkGroups: [], typeFlags: [], typeAssembly: [] };
  const matched = { groups: {}, types: {}, attributes: {} };

  // Дубли внутри самого каталога: при создании их отверг бы уникальный индекс
  const seenCodes = new Map();
  const seenNames = new Map();
  for (const attr of catalog.attributes) {
    const code = fold(attr.code);
    const name = fold(attr.name);
    if (seenCodes.has(code)) {
      warnings.push(
        `каталог: код «${attr.code}» повторяется ` +
          `(${seenCodes.get(code)}, ${attr.key})`,
      );
    } else seenCodes.set(code, attr.key);
    if (seenNames.has(name)) {
      warnings.push(
        `каталог: атрибут «${attr.name}» повторяется ` +
          `(${seenNames.get(name)}, ${attr.key})`,
      );
    } else seenNames.set(name, attr.key);
  }

  // Группы (при подхвате нужны только новым связкам и связкам без группы —
  // ни тех, ни других нет, ненайденная группа ни на что не влияет)
  const groupsByName = byFolded(existing.groups, "name");
  const groupBase = existing.groups.length ? maxOrder(existing.groups) + 1 : 0;
  for (const group of catalog.groups) {
    const found = groupsByName.get(fold(group.name));
    if (isHidden(found)) {
      clash("groups", group.key, found);
      continue;
    }
    if (found) matched.groups[group.key] = found._id;
    else if (!pickUpOnly) {
      create.groups.push({
        key: group.key,
        name: group.name,
        order: groupBase + (group.order || 0),
      });
    }
  }

  // Атрибуты
  const attrsByCode = byFolded(existing.attributes, "code");
  const attrsByName = byFolded(existing.attributes, "name");
  // Тип значения, который будет у атрибута в базе: подхваченного — его собственный
  const valueTypeByKey = new Map();
  for (const attr of catalog.attributes) {
    const options = (attr.options || []).map(normalizeOption);
    const found = attrsByCode.get(fold(attr.code)) || attrsByName.get(fold(attr.name));
    if (isHidden(found)) {
      clash("attributes", attr.key, found);
      continue;
    }
    if (!found && pickUpOnly) {
      warnings.push(`подхват: атрибут «${attr.name}» не найден`);
      continue;
    }
    valueTypeByKey.set(attr.key, found ? found.valueType : attr.valueType);
    if (!found) {
      const doc = { key: attr.key, code: attr.code, name: attr.name, valueType: attr.valueType };
      if (attr.unit) doc.unit = attr.unit;
      if (options.length) doc.options = options;
      create.attributes.push(doc);
      continue;
    }
    const twin = Object.keys(matched.attributes).find(
      (key) => idKey(matched.attributes[key]) === idKey(found._id),
    );
    if (twin) warnings.push(`атрибут «${found.name}» подхвачен дважды: ${twin} и ${attr.key}`);
    matched.attributes[attr.key] = found._id;
    if (found.valueType !== attr.valueType) {
      warnings.push(
        `атрибут «${found.name}» подхвачен с типом значения ${found.valueType}, ` +
          `в каталоге — ${attr.valueType}`,
      );
    }
    if (!pickUpOnly && CHOICE_TYPES.has(found.valueType) && options.length) {
      const have = new Set((found.options || []).map((option) => fold(option.value)));
      const add = options.filter((option) => !have.has(fold(option.value)));
      if (add.length) update.attributeOptions.push({ _id: found._id, add });
    }
  }

  // Типы и их связки
  const typesByName = byFolded(existing.types, "name");
  const linksByPair = new Map();
  const lastOrderByType = new Map();
  for (const link of existing.links) {
    linksByPair.set(`${idKey(link.deviceTypeId)}:${idKey(link.attributeId)}`, link);
    const typeId = idKey(link.deviceTypeId);
    lastOrderByType.set(
      typeId,
      Math.max(lastOrderByType.get(typeId) ?? -Infinity, Number(link.order) || 0),
    );
  }

  const groupKeys = new Set(catalog.groups.map((group) => group.key));
  const attrKeys = new Set(catalog.attributes.map((attr) => attr.key));
  // Атрибуты, которые будут в базе: при подхвате — только найденные; пропущенные — нет
  const liveAttrKeys = pickUpOnly
    ? new Set(Object.keys(matched.attributes))
    : new Set([...attrKeys].filter((key) => !skipped.attributes.has(key)));
  // Для проверки сборки: тип-комплектующая (по каталогу или в базе), его атрибуты
  const componentTypeKeys = new Set();
  const attrKeysByType = new Map();
  const foundByTypeKey = new Map();
  for (const type of catalog.types) {
    const flags = {};
    for (const flag of TYPE_FLAGS) if (type.flags?.[flag]) flags[flag] = true;
    const found = typesByName.get(fold(type.name));
    if (isHidden(found)) {
      clash("types", type.key, found);
      continue;
    }
    if (!found && pickUpOnly) {
      warnings.push(`подхват: тип «${type.name}» не найден`);
      continue;
    }
    if (found) foundByTypeKey.set(type.key, found);
    // При подхвате флаг не ставится — комплектующая только та, что уже в базе
    if ((!pickUpOnly && flags.isComponent) || found?.isComponent) {
      componentTypeKeys.add(type.key);
    }
    attrKeysByType.set(type.key, new Set());
    let nextOrder = 0;
    if (found) {
      matched.types[type.key] = found._id;
      if (!pickUpOnly && flags.isComponent && !found.isComponent) {
        update.typeFlags.push({ _id: found._id, set: { isComponent: true } });
      }
      const last = lastOrderByType.get(idKey(found._id));
      if (last !== undefined) nextOrder = last + 1;
    } else {
      create.types.push({ key: type.key, name: type.name, flags });
    }

    const seenAttrs = new Set();
    for (const item of type.attributes || []) {
      if (!attrKeys.has(item.attr)) {
        warnings.push(`каталог: у типа «${type.name}» неизвестный атрибут ${item.attr}`);
        continue;
      }
      // Ненайденный атрибут уже в предупреждениях — связку молча пропускаем
      if (!liveAttrKeys.has(item.attr)) continue;
      let groupKey = item.group ?? null;
      if (groupKey && !groupKeys.has(groupKey)) {
        warnings.push(`каталог: у типа «${type.name}» неизвестная группа ${groupKey}`);
        groupKey = null;
      }
      // Группа пропущена (скрытое имя, уже в предупреждениях) — связка без группы
      if (groupKey && skipped.groups.has(groupKey)) groupKey = null;
      const attrId = Object.hasOwn(matched.attributes, item.attr)
        ? matched.attributes[item.attr]
        : undefined;
      // Два ключа, подхватившие один документ, — одна связка
      const ref = attrId !== undefined ? `id:${idKey(attrId)}` : `key:${item.attr}`;
      if (seenAttrs.has(ref)) {
        warnings.push(`каталог: у типа «${type.name}» атрибут ${item.attr} повторяется`);
        continue;
      }
      seenAttrs.add(ref);
      const link = found && attrId !== undefined
        ? linksByPair.get(`${idKey(found._id)}:${idKey(attrId)}`)
        : undefined;
      if (link) {
        attrKeysByType.get(type.key).add(item.attr);
        if (!pickUpOnly && groupKey && link.groupId == null) {
          update.linkGroups.push({ _id: link._id, groupKey });
        }
        continue;
      }
      if (pickUpOnly) {
        const attrName = catalog.attributes.find((attr) => attr.key === item.attr).name;
        warnings.push(`подхват: у типа «${type.name}» нет связки с атрибутом «${attrName}»`);
        continue;
      }
      attrKeysByType.get(type.key).add(item.attr);
      create.links.push({
        typeKey: type.key,
        attrKey: item.attr,
        groupKey,
        required: Boolean(item.required),
        order: nextOrder++,
      });
    }
  }

  // «Своя сборка»: только типу без слотов
  for (const type of catalog.types) {
    if (!type.assembly || skipped.types.has(type.key)) continue;
    const found = foundByTypeKey.get(type.key);
    // При подхвате ненайденный собираемый тип уже в предупреждениях
    if (pickUpOnly && !found) continue;
    if (found?.assembly?.slots?.length) continue;
    const assembly = planAssembly(type, {
      componentTypeKeys,
      attrKeysByType,
      valueTypeByKey,
      attrKeys: liveAttrKeys,
      warnings,
    });
    if (!assembly.slots.length) continue;
    update.typeAssembly.push({ _id: found ? found._id : null, typeKey: type.key, assembly });
  }

  return { create, update, matched, warnings, conflicts };
};

const DEFAULT_MODELS = { AttributeGroup, DeviceType, DeviceAttribute, DeviceTypeAttribute };

/** Лёгкие выборки из базы, на которых строится план (см. planCatalog). */
const loadExisting = async (models = DEFAULT_MODELS) => ({
  groups: await models.AttributeGroup.find({}).select("name order isActive").lean(),
  types: await models.DeviceType.find({}).select("name isComponent isActive assembly.slots").lean(),
  attributes: await models.DeviceAttribute.find({}).select("code name valueType options isActive").lean(),
  links: await models.DeviceTypeAttribute.find({}).select("deviceTypeId attributeId groupId order").lean(),
});

/**
 * Читает базу, строит план и пишет его. Созданное копится по `_id`; при сбое
 * оно удаляется по этим спискам (транзакций нет), ошибка пробрасывается —
 * повторный прогон начнёт с чистого листа. Дописанное (варианты, группы
 * связок, флаг) не откатывается: это и так только добавление, а повтор его не
 * задвоит. `userId` (необязателен) — автор: пишется в createdBy/updatedBy
 * созданного и в updatedBy дописанного; без него эти поля не трогаются.
 * Результат несёт `ids` — ключи каталога → `_id` (созданные и подхваченные).
 */
const applyCatalog = async (
  catalog,
  { log = () => {}, models = DEFAULT_MODELS, pickUpOnly = false, hiddenClash = "warn", userId } = {},
) => {
  const {
    AttributeGroup: Group,
    DeviceType: Type,
    DeviceAttribute: Attr,
    DeviceTypeAttribute: Link,
  } = models;
  const existing = await loadExisting(models);
  const author = userId ? { createdBy: userId, updatedBy: userId } : {};
  const editor = userId ? { updatedBy: userId } : {};
  const plan = planCatalog(catalog, existing, { pickUpOnly, hiddenClash });
  if (plan.conflicts.length) throw Object.assign(new Error(plan.conflicts.join("; ")), { conflict: true });
  for (const warning of plan.warnings) log(`warning: ${warning}`);

  const ids = {
    groups: { ...plan.matched.groups },
    types: { ...plan.matched.types },
    attributes: { ...plan.matched.attributes },
  };
  const created = { groups: [], types: [], attributes: [], links: [] };
  let optionsPushed = false;

  try {
    for (const group of plan.create.groups) {
      const doc = await Group.create({ name: group.name, order: group.order, ...author });
      created.groups.push(doc._id);
      ids.groups[group.key] = doc._id;
    }
    for (const type of plan.create.types) {
      const doc = await Type.create({ name: type.name, ...type.flags, ...author });
      created.types.push(doc._id);
      ids.types[type.key] = doc._id;
    }
    for (const attr of plan.create.attributes) {
      const { key, ...fields } = attr;
      // Код каталога занят (подхват его бы нашёл, но мало ли) — свободный по имени
      if (await Attr.exists({ code: fields.code })) {
        fields.code = await uniqueAttributeCode(Attr, fields.name);
      }
      const doc = await Attr.create({ ...fields, ...author });
      created.attributes.push(doc._id);
      ids.attributes[key] = doc._id;
    }
    for (const link of plan.create.links) {
      const doc = await Link.create({
        deviceTypeId: ids.types[link.typeKey],
        attributeId: ids.attributes[link.attrKey],
        groupId: link.groupKey ? ids.groups[link.groupKey] : null,
        required: link.required,
        order: link.order,
        ...author,
      });
      created.links.push(doc._id);
    }
    // Дописывание идёт внутри той же защиты: сбой здесь откатывает созданное по
    // _id. Уже добавленные варианты (и группы связок, флаги, сборки) откатить
    // нельзя — это только добавление, повтор прогона их не задвоит.
    // optionsPushed говорит вызывающему, что часть вариантов могла дописаться.
    for (const { _id, add } of plan.update.attributeOptions) {
      optionsPushed = true; // с этого момента сбой мог оставить часть вариантов
      await Attr.updateOne(
        { _id },
        userId
          ? { $push: { options: { $each: add } }, $set: editor }
          : { $push: { options: { $each: add } } },
      );
    }
    for (const { _id, groupKey } of plan.update.linkGroups) {
      // Только если группы всё ещё нет — пока шёл сид, её мог задать человек
      await Link.updateOne(
        { _id, groupId: null },
        { $set: { groupId: ids.groups[groupKey], ...editor } },
      );
    }
    for (const { _id, set } of plan.update.typeFlags) {
      await Type.updateOne({ _id }, { $set: { ...set, ...editor } });
    }
    for (const { typeKey, assembly } of plan.update.typeAssembly) {
      // Только пока слотов нет — пока шёл сид, сборку мог настроить человек
      await Type.updateOne(
        {
          _id: ids.types[typeKey],
          $or: [{ "assembly.slots": { $exists: false } }, { "assembly.slots": { $size: 0 } }],
        },
        {
          $set: {
            "assembly.enabled": assembly.enabled,
            "assembly.slots": assembly.slots.map((slot) => ({
              typeId: ids.types[slot.typeKey],
              required: slot.required,
              multiple: slot.multiple,
            })),
            "assembly.keySpecs": assembly.keySpecs.map((spec) => ({
              typeId: ids.types[spec.typeKey],
              source: spec.source,
              attributeId: spec.attrKey ? ids.attributes[spec.attrKey] : null,
              aggregate: spec.aggregate,
            })),
            ...editor,
          },
        },
      );
    }
  } catch (error) {
    if (optionsPushed) error.optionsPushed = true;
    log(`rolling back: ${error.message}`);
    // Обратный порядок: связки ссылаются на типы, атрибуты и группы
    for (const [model, list] of [
      [Link, created.links],
      [Attr, created.attributes],
      [Type, created.types],
      [Group, created.groups],
    ]) {
      if (!list.length) continue;
      try {
        await model.deleteMany({ _id: { $in: list } });
      } catch (rollbackError) {
        // Сбой отката не должен подменить исходную ошибку — лишь сообщаем остаток
        log(
          `rollback failed for ${model.modelName}: ${rollbackError.message}; ` +
            `leftover _ids: ${list.map(String).join(", ")}`,
        );
      }
    }
    throw error;
  }

  const result = {
    created: {
      groups: created.groups.length,
      types: created.types.length,
      attributes: created.attributes.length,
      links: created.links.length,
    },
    updated: {
      attributeOptions: plan.update.attributeOptions.length,
      linkGroups: plan.update.linkGroups.length,
      typeFlags: plan.update.typeFlags.length,
      typeAssembly: plan.update.typeAssembly.length,
    },
    warnings: plan.warnings,
    ids,
  };
  const matchedCount = (list) => Object.keys(list).length;
  log(
    `created: ${result.created.groups} groups, ${result.created.types} types, ` +
      `${result.created.attributes} attributes, ${result.created.links} links`,
  );
  log(
    `picked up: ${matchedCount(plan.matched.groups)} groups, ` +
      `${matchedCount(plan.matched.types)} types, ` +
      `${matchedCount(plan.matched.attributes)} attributes`,
  );
  log(
    `updated: ${result.updated.attributeOptions} attributes got options, ` +
      `${result.updated.linkGroups} links got a group, ` +
      `${result.updated.typeFlags} types became components, ` +
      `${result.updated.typeAssembly} types got an assembly`,
  );
  return result;
};

const VALUE_TYPE_LABELS = {
  string: "строка",
  number: "число",
  boolean: "да/нет",
  select: "выбор",
  multiselect: "множественный выбор",
  text: "текст",
};

/**
 * План человеку: по строке на изменение, по-русски, без id. `catalog` — тот
 * же, что отдан planCatalog (имена берутся из него по ключам). Предупреждения
 * плана — в конце, «Внимание: …». Ничего не меняется — одна строка об этом.
 */
const describePlan = (plan, catalog) => {
  const lines = [];
  const typeByKey = new Map(catalog.types.map((type) => [type.key, type]));
  const attrByKey = new Map(catalog.attributes.map((attr) => [attr.key, attr]));
  const keyOfId = (map, id) => Object.keys(map).find((key) => idKey(map[key]) === idKey(id));
  const typeName = (key) => typeByKey.get(key)?.name ?? key;
  const attrName = (key) => attrByKey.get(key)?.name ?? key;

  for (const group of catalog.groups) {
    if (Object.hasOwn(plan.matched.groups, group.key)) lines.push(`Группа «${group.name}» уже есть — используется`);
  }
  for (const group of plan.create.groups) lines.push(`Новая группа «${group.name}»`);

  for (const type of catalog.types) {
    if (!Object.hasOwn(plan.matched.types, type.key)) continue;
    const flagged = plan.update.typeFlags.some(
      (item) => idKey(item._id) === idKey(plan.matched.types[type.key]),
    );
    lines.push(
      flagged
        ? `Тип «${type.name}» уже есть — станет комплектующей`
        : `Тип «${type.name}» уже есть — используется`,
    );
  }
  for (const type of plan.create.types) {
    lines.push(`Новый тип «${type.name}» (комплектующая: ${type.flags.isComponent ? "да" : "нет"})`);
  }

  for (const attr of catalog.attributes) {
    if (Object.hasOwn(plan.matched.attributes, attr.key)) lines.push(`Атрибут «${attr.name}» уже есть — используется`);
  }
  for (const attr of plan.create.attributes) {
    const kind = VALUE_TYPE_LABELS[attr.valueType] ?? attr.valueType;
    lines.push(`Новый атрибут «${attr.name}» (${attr.unit ? `${kind}, ${attr.unit}` : kind})`);
  }
  for (const { _id, add } of plan.update.attributeOptions) {
    const key = keyOfId(plan.matched.attributes, _id);
    lines.push(`Атрибут «${attrName(key)}»: новые варианты ${add.map((option) => option.label).join(", ")}`);
  }

  const linksByType = new Map();
  for (const link of plan.create.links) {
    const list = linksByType.get(link.typeKey) ?? [];
    list.push(`${attrName(link.attrKey)}${link.required ? "*" : ""}`);
    linksByType.set(link.typeKey, list);
  }
  for (const [typeKey, names] of linksByType) lines.push(`Тип «${typeName(typeKey)}»: атрибуты ${names.join(", ")}`);
  if (plan.update.linkGroups.length) {
    lines.push(`Связкам без группы будет назначена группа: ${plan.update.linkGroups.length}`);
  }

  for (const { typeKey, assembly } of plan.update.typeAssembly) {
    const slots = assembly.slots.map((slot) => `${typeName(slot.typeKey)}${slot.required ? "*" : ""}`);
    const specs = assembly.keySpecs.length ? `; ключевых характеристик: ${assembly.keySpecs.length}` : "";
    lines.push(`Тип «${typeName(typeKey)}»: слоты ${slots.join(", ")}${specs}`);
  }

  if (!lines.length) lines.push("Каталог не меняется");
  for (const warning of plan.warnings) lines.push(`Внимание: ${warning}`);
  return lines;
};

module.exports = { hiddenNameTaken, planCatalog, applyCatalog, loadExisting, describePlan };
