// Назначение типа устройства — взаимоисключающий фасет модели.
// «Основные устройства» — типы без спец-флагов (не комплектующие/расходники/
// периферия). Опции нужны и Sheet-фильтру, и бейджу активного фильтра.
export const KIND_OPTIONS = [
  { value: "primary", label: "Основные устройства" },
  { value: "component", label: "Комплектующие" },
  { value: "consumable", label: "Расходники" },
  { value: "peripheral", label: "Периферия" },
];

export const kindLabel = (value) =>
  KIND_OPTIONS.find((option) => option.value === value)?.label ?? value;
