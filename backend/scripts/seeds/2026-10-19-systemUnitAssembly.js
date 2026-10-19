/**
 * Второй сид каталога инвентаря (спека «Инвентарь: группы характеристик…»,
 * приложение A, «Собираемый тип», и «Решения исполнителя»): «Своя сборка»
 * «Системного блока» — слоты комплектующих и ключевые характеристики.
 *
 * Определения не дублируются: типы, атрибуты и группы берутся из первого сида
 * по ключам — ровно те, что нужны сборке (сам «Системный блок», девять типов
 * слотов и связки с атрибутами ключевых характеристик). Всё это первый сид уже
 * создал, так что здесь только подхват (`pickUpOnly`): сид ничего не создаёт и
 * не дописывает. Переименованное или удалённое владельцем не воскрешается —
 * предупреждение, зависящие слоты и ключевые характеристики выпадают; не
 * найден сам «Системный блок» — ничего не пишется.
 *
 * Сборка ставится, только если у «Системного блока» слотов ещё нет; настроенную
 * владельцем — не трогает (services/inventory/catalogSeed, `typeAssembly`).
 */
const { applyCatalog } = require("../../services/inventory/catalogSeed");
const { catalog: base } = require("./2026-10-19-inventoryCatalog");

// * — обязательный; «несколько» — в слот ставится больше одной детали
const assembly = {
  slots: [
    { type: "cpu", required: true }, // Процессор*
    { type: "motherboard", required: true }, // Материнская плата*
    { type: "memory", required: true, multiple: true }, // Оперативная память*, несколько
    { type: "drive", required: true, multiple: true }, // Накопитель*, несколько
    { type: "psu", required: true }, // Блок питания*
    { type: "case", required: true }, // Корпус*
    { type: "gpu" }, // Видеокарта
    { type: "cooler" }, // Охлаждение
    { type: "wifiAdapter" }, // Wi-Fi адаптер
  ],
  keySpecs: [
    { type: "cpu", source: "model", aggregate: "first" },
    { type: "memory", source: "attribute", attr: "moduleSize", aggregate: "sum" },
    { type: "memory", source: "attribute", attr: "memoryType", aggregate: "first" },
    { type: "drive", source: "attribute", attr: "driveCapacity", aggregate: "sum" },
    { type: "drive", source: "attribute", attr: "driveType", aggregate: "list" },
    { type: "gpu", source: "model", aggregate: "first" },
  ],
};

const TYPE_KEY = "systemUnit";

/** Из первого каталога — только то, на что ссылается сборка. */
const pick = () => {
  const slotKeys = new Set(assembly.slots.map((slot) => slot.type));
  const attrsByType = new Map();
  for (const spec of assembly.keySpecs) {
    if (!spec.attr) continue;
    if (!attrsByType.has(spec.type)) attrsByType.set(spec.type, new Set());
    attrsByType.get(spec.type).add(spec.attr);
  }
  const byKey = (list, key) => {
    const found = list.find((item) => item.key === key);
    if (!found) throw new Error(`первый сид: нет ключа ${key}`);
    return found;
  };

  const types = [byKey(base.types, TYPE_KEY), ...[...slotKeys].map((key) => byKey(base.types, key))]
    .map((type) => ({
      ...type,
      attributes: type.attributes.filter((link) => attrsByType.get(type.key)?.has(link.attr)),
      ...(type.key === TYPE_KEY ? { assembly } : {}),
    }));
  const links = types.flatMap((type) => type.attributes);
  const attributes = [...new Set(links.map((link) => link.attr))].map((key) =>
    byKey(base.attributes, key),
  );
  const groups = [...new Set(links.map((link) => link.group).filter(Boolean))].map((key) =>
    byKey(base.groups, key),
  );
  return { groups, types, attributes };
};

const catalog = pick();

module.exports = {
  catalog,
  apply: ({ log }) => applyCatalog(catalog, { log, pickUpOnly: true }),
};
