// Пригодность массовых действий над выделенными заметками. Каждая функция
// возвращает строку-причину блокировки (тултип на десктопе, подсказка по тапу на
// мобилке) либо null, если действие применимо ко всему выделению. Решение
// принимается на клиенте до клика — пользователь сразу видит, что так нельзя.
//
// В причине называем заметки заголовками, а не id: пользователь не должен
// сопоставлять внутренние идентификаторы со списком у себя на экране.

const MAX_TITLES = 3;

const titles = (notes) => {
  const names = notes.map((note) => `«${note.title}»`);
  if (names.length <= MAX_TITLES) {
    return names.join(", ");
  }
  return `${names.slice(0, MAX_TITLES).join(", ")} и ещё ${names.length - MAX_TITLES}`;
};

const nothingSelected = "Не выбрано ни одной заметки";

// Проверить: нельзя проверять архивные — их сначала восстанавливают.
export const verifyReason = (selectedItems) => {
  if (!selectedItems.length) return nothingSelected;

  const archived = selectedItems.filter((note) => note.archivedAt);
  if (archived.length) {
    return `Заметки в архиве нельзя отметить проверенными. Не подходят: ${titles(archived)}`;
  }

  return null;
};

// Решения по удалению применимы только к заметкам с запросом на удаление.
const deletionReason = (selectedItems) => {
  if (!selectedItems.length) return nothingSelected;

  const notPending = selectedItems.filter((note) => !note.pendingDeletion);
  if (notPending.length) {
    return `Запрос на удаление есть не у всех выбранных заметок. Не подходят: ${titles(notPending)}`;
  }

  return null;
};

export const confirmDeletionReason = deletionReason;
export const declineDeletionReason = deletionReason;

// Решения по архивации применимы только к заметкам с запросом на архивацию.
const archiveReason = (selectedItems) => {
  if (!selectedItems.length) return nothingSelected;

  const notPending = selectedItems.filter((note) => !note.pendingArchive);
  if (notPending.length) {
    return `Запрос на архивацию есть не у всех выбранных заметок. Не подходят: ${titles(notPending)}`;
  }

  return null;
};

export const confirmArchiveReason = archiveReason;
export const declineArchiveReason = archiveReason;
