import { format, parseISO } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

import { getLocalStorageData } from "./auth";

// Единая бизнес-таймзона приложения (Preferences.timezone; кладётся в
// localStorage при логине и обновляется на странице настроек). Читаем ПРИ
// КАЖДОМ вызове — значение, захваченное при загрузке модуля, протухает после
// логина или смены настройки до перезагрузки страницы. Дефолт совпадает со
// схемой Preferences и backend/utils/datetime.js.
export const DEFAULT_TIMEZONE = "Europe/Moscow";

const tz = () => getLocalStorageData().timezone || DEFAULT_TIMEZONE;

/* ── Отображение ИНСТАНТОВ (моментов времени) — в бизнес-таймзоне ── */

// «пн, 08.07.2026, 14:30» — канонический формат «дата и время».
export const formatDate = (date) =>
  new Date(date).toLocaleDateString("ru", {
    timeZone: tz(),
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// «08.07.2026» — только дата инстанта.
export const formatShortDate = (date) =>
  new Date(date).toLocaleDateString("ru", {
    timeZone: tz(),
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });

// «8 июля, 14:30» — компактный вариант без года.
export const formatDateTime = (date) =>
  new Date(date).toLocaleDateString("ru", {
    timeZone: tz(),
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// «08.07, 14:30» — сверхкомпактный: оси/тултипы графиков и лент.
export const formatDayMonthTime = (date) =>
  new Date(date).toLocaleString("ru", {
    timeZone: tz(),
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

// «июль 2026» / «июль» — заголовки месячных периодов.
export const formatMonthYear = (date) =>
  new Date(date).toLocaleDateString("ru", {
    timeZone: tz(),
    month: "long",
    year: "numeric",
  });

export const formatMonth = (date) =>
  new Date(date).toLocaleDateString("ru", {
    timeZone: tz(),
    month: "long",
  });

/* ── КАЛЕНДАРНЫЕ даты (поля «только дата»: покупка, гарантия, срок действия —
      в БД хранятся UTC-полночью) ── */

// Показываем такие поля в UTC, чтобы календарный день не съезжал ни в какой
// таймзоне браузера (для отрицательных смещений локальный рендер даёт «вчера»).
export const formatCalendarDate = (date) =>
  date ? new Date(date).toLocaleDateString("ru-RU", { timeZone: "UTC" }) : null;

// Значение для <input type="date">: ЛОКАЛЬНЫЙ календарный день инстанта.
// НИКОГДА не получайте его через toISOString().split("T")[0] — ISO даёт
// UTC-день, для восточных поясов это «вчера» до смены суток по UTC (при +10 —
// каждое утро до 10:00).
export const toDateInputValue = (date = new Date()) => {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ── <input type="datetime-local"> ↔ UTC (симметричная пара в бизнес-таймзоне) ── */

// Значение для <input type="datetime-local">: настенное время инстанта в
// бизнес-таймзоне. Пара к localToUtc (обратное преобразование при сохранении).
export const toDateTimeLocal = (date = new Date()) =>
  format(toZonedTime(new Date(date), tz()), "yyyy-MM-dd'T'HH:mm");

// То же для ISO-строки с бэка (исторический альяс toDateTimeLocal).
export const utcToLocalForm = (utcDateString) =>
  format(toZonedTime(parseISO(utcDateString), tz()), "yyyy-MM-dd'T'HH:mm");

export const utcToLocal = (localDateString) => {
  return toZonedTime(new Date(localDateString), tz()).toISOString();
};

export const localToUtc = (localDateString) => {
  return fromZonedTime(new Date(localDateString), tz()).toISOString();
};

/* ── Устаревшее (мигрируется на toDateTimeLocal/utcToLocalForm) ── */

// БРАУЗЕРНАЯ таймзона, а не бизнес — оставлено до миграции форм работ; в новых
// местах не использовать.
export const timeDateInputFormat = (unformattedDate) => {
  const date = new Date(unformattedDate);
  return format(date, "yyyy-MM-dd'T'HH:mm");
};
