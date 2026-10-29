const { parseMultiValue } = require("./assemblyKeySpecs");

// Проверка значения конфигурации по типу атрибута: общая для находок агента
// (mcp/inventoryFindings) и каталожных операций (catalogOps).

const BOOLEANS = new Set(["true", "false", "да", "нет", "1", "0"]);

/** Значение конфигурации подходит атрибуту? Пустое значение — «не задано», это не ошибка. */
const isValidValue = (attr, value) => {
  const text = String(value ?? "").trim();
  if (!text) return true;
  const options = (attr.options ?? []).map((o) => String(o.value));
  switch (attr.valueType) {
    case "number":
      return Number.isFinite(Number(text.replace(",", ".")));
    case "boolean":
      return BOOLEANS.has(text.toLowerCase());
    case "select":
      return options.includes(text);
    case "multiselect":
      return parseMultiValue(text).every((v) => options.includes(String(v)));
    default:
      return true;
  }
};

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

// Значение атрибута после переименований map (from -> to): у multiselect —
// элементы JSON-массива на местах, повтор выпадает; не JSON — как одно значение.
// Общее для renameOptions (catalogEditOps) и optionMap слияния (catalogMergeRules)
const renameValue = (valueType, value, map) => {
  if (valueType !== "multiselect") return map.get(value) ?? value;
  let list;
  try {
    list = JSON.parse(value);
  } catch {
    return map.get(value) ?? value;
  }
  if (!Array.isArray(list)) return map.get(value) ?? value;
  return JSON.stringify([...new Set(list.map((item) => map.get(String(item)) ?? String(item)))]);
};

module.exports = { isValidValue, storedValue, renameValue };
