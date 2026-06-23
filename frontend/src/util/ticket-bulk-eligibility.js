// Пригодность массовых действий над выделенными заявками. Каждая функция
// возвращает строку-причину блокировки (для тултипа на disabled-кнопке) либо
// null, если действие применимо ко всему текущему выделению. Решение принимается
// на клиенте до клика — пользователь сразу видит, что так сделать нельзя.

const numbers = (items) => items.map((t) => `#${t.num}`).join(", ");

const isResponsible = (ticket, userId) =>
  ticket.responsibles?.some((r) => r._id?.toString() === userId?.toString());

// Принять в работу: все заявки в статусе «Не в работе», и текущий пользователь —
// ответственный (либо у заявки нет ответственных и есть право canPerformTickets).
export const takeToWorkReason = (selectedItems, { userId, permissions }) => {
  if (!selectedItems.length) return "Не выбрано ни одной заявки";

  const wrongState = selectedItems.filter((t) => t.state !== "Не в работе");
  if (wrongState.length) {
    return `Принять в работу можно только заявки в статусе «Не в работе». Не подходят: ${numbers(wrongState)}`;
  }

  const notAllowed = selectedItems.filter((t) => {
    const hasNoResponsibles = (t.responsibles?.length ?? 0) === 0;
    return !(
      isResponsible(t, userId) ||
      (hasNoResponsibles && permissions.canPerformTickets)
    );
  });
  if (notAllowed.length) {
    return `Принять в работу можно только заявки, назначенные на вас, или без ответственных. Не подходят: ${numbers(notAllowed)}`;
  }

  return null;
};

// Комментарий можно добавить к любым выбранным заявкам.
export const commentReason = (selectedItems) =>
  selectedItems.length ? null : "Не выбрано ни одной заявки";

// Добавить работы: одна запись работы привязывается сразу к нескольким заявкам, а
// у работы единое поле company — поэтому все заявки должны быть одной компании.
export const addWorksReason = (selectedItems) => {
  if (!selectedItems.length) return "Не выбрано ни одной заявки";

  const companyIds = new Set(
    selectedItems.map((t) => t.company?._id?.toString()),
  );
  if (companyIds.size > 1) {
    return "Работы можно добавить только к заявкам одной компании";
  }

  return null;
};

// Закрыть: все заявки в работе, текущий пользователь — ответственный, и соблюдено
// правило о работах (есть завершённые работы, либо право закрывать без работ,
// либо модуль учёта времени отключён).
export const closeReason = (selectedItems, { userId, permissions }) => {
  if (!selectedItems.length) return "Не выбрано ни одной заявки";

  const wrongState = selectedItems.filter((t) => t.state !== "В работе");
  if (wrongState.length) {
    return `Закрыть можно только заявки в статусе «В работе». Не подходят: ${numbers(wrongState)}`;
  }

  const notResponsible = selectedItems.filter((t) => !isResponsible(t, userId));
  if (notResponsible.length) {
    return `Вы не ответственны за заявки: ${numbers(notResponsible)}`;
  }

  if (permissions.canAvoidWorks || !permissions.canUseTimeTrackingModule) {
    return null;
  }

  const noWorks = selectedItems.filter((t) => !t.hasFinishedWorks);
  if (noWorks.length) {
    return `Нельзя закрыть без указанных работ: ${numbers(noWorks)}`;
  }

  return null;
};
