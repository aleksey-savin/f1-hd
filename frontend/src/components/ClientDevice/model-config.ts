/**
 * Что форма устройства показывает под моделью: «picker» — выбор конфигурации
 * (их больше одной, правило needsConfiguration), «summary» — сводку
 * характеристик единственной (устройство привяжет к ней сервер), null —
 * ничего (модель не выбрана или конфигурации не загрузились).
 */
export const configFieldMode = (
  configurations: unknown[] | null | undefined,
): "picker" | "summary" | null => {
  const count = configurations?.length ?? 0;
  if (count > 1) return "picker";
  if (count === 1) return "summary";
  return null;
};
