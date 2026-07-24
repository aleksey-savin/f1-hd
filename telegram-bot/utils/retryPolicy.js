// Политика повторов недоставленных уведомлений (telegram + email):
// до NOTIFY_MAX_ATTEMPTS попыток с паузой NOTIFY_RETRY_INTERVAL_MINUTES.
// Инженерная константа, а не настройка: из веб-настроек убрана осознанно
// (2026-07-24) — админ не может осмысленно выбирать «3 попытки или 5».
module.exports = {
  NOTIFY_MAX_ATTEMPTS: 3,
  NOTIFY_RETRY_INTERVAL_MINUTES: 15,
};
