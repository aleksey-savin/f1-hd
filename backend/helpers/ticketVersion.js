// Оптимистичная блокировка заявок. Клиент присылает expectedVersion — версию
// заявки, которую видит пользователь. Если она не совпадает с текущей версией в
// БД, значит заявку успели изменить, и мутацию нужно отклонить (409), а не
// затирать чужие правки.

// expectedVersion отсутствует/пустой/нечисловой → проверку пропускаем (старые
// заявки без версии, мягкий rollout). Иначе сравниваем с текущей версией заявки.
exports.isStaleVersion = (ticket, expectedVersion) => {
  if (
    expectedVersion === undefined ||
    expectedVersion === null ||
    expectedVersion === ""
  ) {
    return false;
  }
  const expected = Number(expectedVersion);
  if (Number.isNaN(expected)) return false;
  return expected !== (ticket.version ?? 0);
};

exports.sendConflict = (res, ticket) =>
  res.status(409).json({
    conflict: true,
    message: "Заявка была изменена другим пользователем",
    currentVersion: ticket.version ?? 0,
    state: ticket.state,
  });
