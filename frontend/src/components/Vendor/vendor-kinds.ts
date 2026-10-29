// Сегмент назначения на карточке вендора: «Все» + разделы, где у вендора есть
// модели. Одно назначение — сегмента нет (сужать нечего).
import { KIND_OPTIONS, kindOf } from "../DeviceType/kinds.js";

type KindModel = { deviceTypeId?: Record<string, unknown> | null };
export type KindOption = { value: string; label: string; count: number };

export const ALL_KINDS = "all";

export const matchKind = (model: KindModel, kind: string): boolean =>
  kind === ALL_KINDS || kindOf(model.deviceTypeId) === kind;

export const modelKindOptions = (models: KindModel[]): KindOption[] => {
  const counts = new Map<string, number>();
  for (const model of models) {
    const kind = kindOf(model.deviceTypeId);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (counts.size < 2) return [];
  return [
    { value: ALL_KINDS, label: "Все", count: models.length },
    ...KIND_OPTIONS.filter((option) => counts.has(option.value)).map(
      (option) => ({
        ...option,
        count: counts.get(option.value) ?? 0,
      }),
    ),
  ];
};
