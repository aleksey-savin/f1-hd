/**
 * Выбор модели детали по слоту — чистая часть, общая у формы сборки и шага
 * «Комплектующие» мастера устройства (React-часть — part-pickers.jsx).
 */

type Ref = { _id: string } | string | null | undefined;

export interface PickerModel {
  _id: string;
  name?: string;
  deletedAt?: string | null;
  vendorId?: { _id?: string; name?: string } | null;
  deviceTypeId?: Ref;
  configurationsCount?: number;
}

export type ModelGone = "deleted" | "retyped" | null;

export const idOf = (ref: Ref): string | null =>
  (ref && typeof ref === "object" ? ref._id : ref) || null;

export const modelTitle = (model: PickerModel): string =>
  [model.vendorId?.name, model.name].filter(Boolean).join(" ") ||
  "Без названия";

// «Ещё накопитель»: первое слово строчными, если это обычное слово с
// заглавной; аббревиатуры и «Wi-Fi» остаются как есть
export const lowerFirstWord = (text: string): string => {
  const [word, ...rest] = text.split(" ");
  return /^\p{Lu}\p{Ll}+$/u.test(word)
    ? [word.toLocaleLowerCase("ru"), ...rest].join(" ")
    : text;
};

// Модель детали больше не годится для слота: сервер не примет ни удалённую
// модель, ни модель чужого типа
export const modelGoneOf = (
  model: PickerModel | null | undefined,
  typeId: string | null,
): ModelGone =>
  !model || model.deletedAt
    ? "deleted"
    : idOf(model.deviceTypeId) && idOf(model.deviceTypeId) !== typeId
      ? "retyped"
      : null;

// Подсказка в пустом поле модели — почему прежняя модель не подставилась
export const modelPlaceholder = (modelGone: ModelGone): string =>
  modelGone === "deleted"
    ? "Модель удалена — выберите другую"
    : modelGone === "retyped"
      ? "Модель другого типа — выберите другую"
      : "Выберите модель…";

// Пустой список конфигураций: null — загрузка не удалась
export const configEmptyText = (
  options: unknown[] | null | undefined,
): string =>
  options === null
    ? "Не удалось загрузить конфигурации — выберите модель ещё раз."
    : "Конфигураций нет.";

// Конфигурацию выбирают только у модели, где их больше одной: у единственной
// сервер подставит её сам
export const needsConfiguration = (
  model: PickerModel | null | undefined,
): boolean => (model?.configurationsCount || 0) > 1;

interface GapSlot {
  typeId: { _id: string; name: string } | null;
  required?: boolean;
}

interface GapRow {
  typeId: string;
  modelId: string | null;
  configId: string | null;
}

/**
 * Чего не хватает, чтобы сохранить: обязательные слоты без модели и строки,
 * где у модели несколько конфигураций, а конфигурация не выбрана. Подписи —
 * для «Не заполнено: …».
 */
export const slotGaps = (
  slots: GapSlot[],
  rows: GapRow[],
  modelById: Map<string, PickerModel>,
): string[] => {
  const nameOf = new Map(
    slots
      .filter((slot) => slot.typeId)
      .map((slot) => [slot.typeId!._id, slot.typeId!.name]),
  );
  const filled = new Set(
    rows.filter((row) => row.modelId).map((row) => row.typeId),
  );
  const gaps = slots
    .filter(
      (slot) => slot.required && slot.typeId && !filled.has(slot.typeId._id),
    )
    .map((slot) => slot.typeId!.name);
  const configGaps = rows
    .filter(
      (row) =>
        row.modelId &&
        needsConfiguration(modelById.get(row.modelId)) &&
        !row.configId,
    )
    .map((row) => nameOf.get(row.typeId) || "—");
  for (const typeName of new Set(configGaps)) {
    gaps.push(`конфигурация: ${typeName}`);
  }
  return gaps;
};
