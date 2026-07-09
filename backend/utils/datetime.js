const { formatInTimeZone } = require("date-fns-tz");

// Единая точка правды о бизнес-таймзоне приложения. Сервер живёт в UTC, поэтому
// любое человекочитаемое время (тексты заявок/комментариев, письма, telegram,
// имена файлов) обязано форматироваться в Preferences.timezone. Дефолт совпадает
// со схемой Preferences (models/preferences.js) — НЕ хардкодьте другие зоны по
// коду, берите константу отсюда.
const DEFAULT_TIMEZONE = "Europe/Moscow";

// Таймзона из настроек с единым дефолтом.
const resolveTimezone = (prefs) => prefs?.timezone || DEFAULT_TIMEZONE;

// Безопасное форматирование в заданной (или дефолтной) таймзоне: битое значение
// зоны в настройках не должно ронять построение текста — откатываемся к
// серверному времени.
const formatInAppTimezone = (date, timeZone, pattern) => {
  try {
    return formatInTimeZone(new Date(date), timeZone || DEFAULT_TIMEZONE, pattern);
  } catch {
    return new Date(date).toLocaleString("ru-RU");
  }
};

// Канонический формат «дата, время» для пользовательских текстов.
const fmtDateTime = (date, timeZone) =>
  date ? formatInAppTimezone(date, timeZone, "dd.MM.yyyy, HH:mm") : "—";

module.exports = {
  DEFAULT_TIMEZONE,
  resolveTimezone,
  formatInAppTimezone,
  fmtDateTime,
};
