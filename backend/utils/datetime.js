const { formatInTimeZone, fromZonedTime } = require("date-fns-tz");

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

// Calendar day of an instant in the explicit organization zone. East of UTC,
// the local day begins before the UTC day. Frontend equivalent: organizationDayKey.
const dayKey = (date, timeZone) =>
  new Date(date).toLocaleDateString("en-CA", {
    timeZone: timeZone || DEFAULT_TIMEZONE,
  });

/** Ключ дня → UTC-полночь: так лежат календарные даты (absence.from/to и др.). */
const dayKeyToUtcMidnight = (key) => new Date(`${key}T00:00:00.000Z`);

// Calendar keys are validated at the API boundary. Shift the key in UTC,
// then resolve each midnight separately so DST days retain their actual length.
const calendarDateRange = (from, to, timeZone) => {
  const midnight = (key, next = false) => {
    if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      throw new RangeError("Expected a YYYY-MM-DD calendar date");
    }
    const date = new Date(`${key}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key) {
      throw new RangeError("Invalid calendar date");
    }
    if (next) date.setUTCDate(date.getUTCDate() + 1);
    return fromZonedTime(`${date.toISOString().slice(0, 10)}T00:00:00`, timeZone || DEFAULT_TIMEZONE);
  };
  const range = {};
  if (from) range.$gte = midnight(from);
  if (to) range.$lt = midnight(to, true);
  if (from && to && from > to) throw new RangeError("Invalid calendar range");
  return range;
};

// New clients submit a day key. Preserve explicitly zoned timestamps from
// older/API clients; interpret legacy unzoned datetime strings in organization time.
const graceDeadline = (value, timeZone) => {
  if (!value) return null;
  let date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date = new Date(calendarDateRange(value, value, timeZone).$lt.getTime() - 1);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) {
    calendarDateRange(value.slice(0, 10), null, timeZone);
    date = fromZonedTime(value, timeZone || DEFAULT_TIMEZONE);
  } else if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    date = new Date(value);
  }
  if (!date || !Number.isFinite(date.getTime())) throw new RangeError("Invalid grace deadline");
  return date;
};

module.exports = {
  calendarDateRange,
  graceDeadline,
  DEFAULT_TIMEZONE,
  resolveTimezone,
  formatInAppTimezone,
  fmtDateTime,
  fmtDayMonth,
  fmtMonthYear,
  dayKey,
  dayKeyToUtcMidnight,
};
