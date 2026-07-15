// Типы данных атрибута устройства: единый словарь для формы, фильтра и меты
// строки списка (значения — enum модели inventory/deviceAttribute).
export const VALUE_TYPES = [
  { value: "string", label: "Строка" },
  { value: "number", label: "Число" },
  { value: "boolean", label: "Да/Нет" },
  { value: "select", label: "Выбор из списка" },
  { value: "multiselect", label: "Множественный выбор" },
  { value: "text", label: "Текст" },
];

export const valueTypeLabel = (value) =>
  VALUE_TYPES.find((type) => type.value === value)?.label ?? value;
