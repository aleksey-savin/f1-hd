// Что отправить в `responsibleId` при сохранении устройства Mikrotik. Бэкенд
// читает отсутствие поля как «не менять», null — как «снять ответственного»
// (parseResponsible в controllers/inventory/mikrotik.js), поэтому поле уходит
// только когда человек его реально изменил, а истинное значение известно.

/** "" — не назначен; undefined — запись ещё не загружена, значение неизвестно */
export const responsiblePatch = ({
  initial,
  current,
}: {
  initial: string | undefined;
  current: string;
}): { responsibleId?: string | null } => {
  if (initial === undefined || current === initial) return {};
  return { responsibleId: current || null };
};
