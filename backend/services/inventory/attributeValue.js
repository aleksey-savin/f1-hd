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

module.exports = { isValidValue };
