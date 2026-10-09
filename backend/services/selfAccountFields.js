/**
 * Что человек правит в СВОЕЙ учётной записи — «Мой аккаунт»,
 * `POST /api/users/update-account`. Всё прочее из тела отбрасывается.
 *
 * Здесь нет email и categories (спека W1, §2). Email — это вход: его меняет
 * администратор в карточке человека, где смена гасит сеансы и уведомляет
 * прежний адрес (services/accountUpdatePolicy.js). Categories — разделы базы
 * знаний, которые человеку открыты: расширять их самому значит выдавать себе
 * доступ. Роли, тип учётной записи и отключение сюда не попадали и раньше.
 */
const SELF_EDITABLE_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "position",
  "notify",
  // Только отвязка: привязку ставит обмен кода (services/telegramActor)
  "telegramBot",
  "timezone",
  "fontScale",
  "plainCanvas",
];

/**
 * Разрешённые поля тела — только собственные ключи объекта. Непришедшее поле
 * остаётся непришедшим: для ручки это «не трогать».
 *
 * @param {object|undefined} body — тело запроса
 * @returns {object}
 */
const pickSelfEditableFields = (body) =>
  Object.fromEntries(
    SELF_EDITABLE_FIELDS.filter((key) => Object.hasOwn(body || {}, key)).map(
      (key) => [key, body[key]],
    ),
  );

module.exports = { SELF_EDITABLE_FIELDS, pickSelfEditableFields };
