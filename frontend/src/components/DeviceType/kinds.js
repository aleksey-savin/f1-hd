// Назначение типа устройства — взаимоисключающий фасет модели. Хранится тремя
// флагами (isComponent/isConsumable/isPeripheral, читает весь бэкенд), но
// взведён не больше одного; «Устройства» — тип без спец-флагов. Опции нужны
// сегменту списка, Sheet-фильтру, бейджу и форме — отсюда отдельный модуль.
export const KIND_OPTIONS = [
  { value: "primary", label: "Устройства" },
  { value: "peripheral", label: "Периферия" },
  { value: "component", label: "Комплектующие" },
  { value: "consumable", label: "Расходники" },
];

export const DEFAULT_KIND = "primary";

export const kindLabel = (value) =>
  KIND_OPTIONS.find((option) => option.value === value)?.label ?? value;

// Форма называет, чем является сам тип, — подписи в единственном числе.
// `single` — хвост кнопки «Новый тип — расходник» в пустом разделе списка.
export const KIND_FORM_OPTIONS = [
  {
    value: "primary",
    label: "Устройство",
    single: "устройство",
    hint: "Самостоятельная единица учёта. Может собираться из комплектующих.",
  },
  {
    value: "peripheral",
    label: "Периферия",
    single: "периферия",
    hint: "Подключается к устройству — монитор, клавиатура, гарнитура. Прикрепляется к устройствам выбранных типов.",
  },
  {
    value: "component",
    label: "Комплектующее",
    single: "комплектующее",
    hint: "Деталь внутри устройства — память, накопитель, плата. Прикрепляется к устройствам выбранных типов.",
  },
  {
    value: "consumable",
    label: "Расходник",
    single: "расходник",
    hint: "Расходуется в работе — картриджи, тонер, батарейки. Прикрепляется к устройствам выбранных типов.",
  },
];

export const isKind = (value) =>
  KIND_OPTIONS.some((option) => option.value === value);

export const kindOf = (type) => {
  if (type?.isComponent) return "component";
  if (type?.isConsumable) return "consumable";
  if (type?.isPeripheral) return "peripheral";
  return "primary";
};

export const kindFlags = (kind) => ({
  isComponent: kind === "component",
  isConsumable: kind === "consumable",
  isPeripheral: kind === "peripheral",
});
