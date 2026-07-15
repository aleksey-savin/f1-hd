// Тип тарификации услуги — ключевой фасет. Общий источник для строки списка,
// фильтра, бейджей активных фильтров и карточки View.
export const TARIFF_TYPES = [
  { value: "fixedPrice", label: "Фиксированная оплата" },
  { value: "hourly", label: "Почасовая оплата" },
  { value: "hourPackage", label: "Пакеты часов" },
];

export const tariffTypeName = (value) =>
  TARIFF_TYPES.find((type) => type.value === value)?.label ?? value;
