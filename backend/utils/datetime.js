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

// Месяцы по-русски — через Intl, а не через date-fns: её локали в
// зависимостях бэкенда нет (стоит только date-fns-tz), а тянуть пакет ради
// одного названия месяца незачем. Шаблоны date-fns вида "d MMMM" дали бы
// «2 August» — в письме клиенту это брак.

/** «2 августа» — для сроков и дат решений в письмах. */
const fmtDayMonth = (date, timeZone) => {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      day: "numeric",
      month: "long",
    }).format(new Date(date));
  } catch {
    return formatInAppTimezone(date, timeZone, "dd.MM.yyyy");
  }
};

/** «июль 2026» — период отчёта (без «г.», которое добавляет Intl). */
const fmtMonthYear = (date, timeZone) => {
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      month: "long",
      year: "numeric",
    })
      .format(new Date(date))
      .replace(/\s*г\.\s*$/, "");
  } catch {
    return formatInAppTimezone(date, timeZone, "MM.yyyy");
  }
};

/**
 * Календарный день инстанта в заданной зоне, ключом «2026-07-08».
 *
 * Нужен там, где сравниваются ДНИ, а не моменты: «сегодня» для отсутствий и
 * статусов присутствия. Сервер живёт в UTC, поэтому `getDate()` и
 * `toISOString().slice(0, 10)` дают день по UTC — для восточных поясов сутки
 * наступают позже, и «сегодня» уезжает. Фронтовая пара — `businessDayKey`
 * в `frontend/src/util/format-date.js`, ботовая — `dayKey` в `tgBotApi`.
 */
const dayKey = (date, timeZone) =>
  new Date(date).toLocaleDateString("en-CA", {
    timeZone: timeZone || DEFAULT_TIMEZONE,
  });

/** Ключ дня → UTC-полночь: так лежат календарные даты (absence.from/to и др.). */
const dayKeyToUtcMidnight = (key) => new Date(`${key}T00:00:00.000Z`);

module.exports = {
  DEFAULT_TIMEZONE,
  resolveTimezone,
  formatInAppTimezone,
  fmtDateTime,
  fmtDayMonth,
  fmtMonthYear,
  dayKey,
  dayKeyToUtcMidnight,
};
