// Метки статусов клиентского устройства — единый источник правды.
// Используется в карточке устройства (Item) и в фильтре списка (Filter).
export const STATUS_LABELS = {
  readyForDeployment: "Готово к выдаче",
  deployed: "Выдано",
  inRepair: "В ремонте",
  decommissioned: "Выведено из эксплуатации",
  inReserve: "В резерве",
  disposed: "Утилизировано",
};

// Тот же справочник в виде массива опций для фильтра.
export const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);

// Цвет бейджа по жизненному циклу актива (готов → выдан → ремонт → списан).
export const STATUS_VARIANTS = {
  readyForDeployment: "success",
  deployed: "primary",
  inRepair: "warning",
  inReserve: "info",
  decommissioned: "secondary",
  disposed: "dark",
};

// Синтетический «производитель» в фильтре — бакет для самосборной техники без
// модели/вендора. Используется в Filter и в сторе списка устройств.
export const CUSTOM_VENDOR_BUCKET = "__custom__";
export const CUSTOM_VENDOR_LABEL = "Кастомная сборка";
