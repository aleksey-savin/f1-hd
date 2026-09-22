/**
 * Категории уведомлений — один список на модель (`models/inAppNotification`),
 * валидацию и фильтр колокольчика. Ключ един с настройками
 * (prefs.notify.personal.X ↔ user.notify.*), поэтому по нему же фильтруется
 * лента: «Комментарии» в колокольчике — это `ticketNewComment` из настроек.
 *
 * Листовой модуль без mongoose: его читает и тест, и модель.
 */
const CATEGORIES = [
  "newTicket",
  "respStateUpdate",
  "ticketStateUpdate",
  "ticketDeadlineUpdate",
  "ticketNewComment",
  "scheduledWorks",
  "absenceRequest",
  "absenceDecision",
  "reportApproval",
  "reportDecision",
];

const KNOWN = new Set(CATEGORIES);

/**
 * Параметр `category` (строка через запятую или массив) → список категорий
 * для `$in`. null — фильтра нет: пусто или ни одной допустимой. Неизвестные
 * молча отбрасываются: старый клиент с чужим ключом получает всю ленту, а не
 * пустую.
 */
const parseCategories = (raw) => {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const list = [
    ...new Set(parts.map((part) => String(part).trim()).filter((part) => KNOWN.has(part))),
  ];
  return list.length ? list : null;
};

module.exports = { CATEGORIES, parseCategories };
