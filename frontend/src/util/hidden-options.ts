// Скрытые записи справочника (слитые и неиспользуемые) в выпадающих списках
// форм не нужны: модели и конфигурации скрыты через deletedAt, типы, атрибуты,
// вендоры и поставщики — через isActive: false.
type Hideable = { _id?: unknown; isActive?: boolean; deletedAt?: unknown };

const isHidden = (item: Hideable): boolean =>
  item.isActive === false || Boolean(item.deletedAt);

// Текущее значение сохранённой формы остаётся в списке, даже скрытое: иначе
// поле показало бы пустоту, а сохранение стёрло бы выбор.
export const visibleOptions = <T extends Hideable>(
  items: T[] | null | undefined,
  currentIds: Array<string | null | undefined> = [],
): T[] => {
  const keep = new Set(currentIds.filter(Boolean).map(String));
  return (items || []).filter(
    (item) => !isHidden(item) || keep.has(String(item._id)),
  );
};
