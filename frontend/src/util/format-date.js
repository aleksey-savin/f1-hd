import { toZonedTime, fromZonedTime } from "date-fns-tz";

import { getLocalStorageData } from "./auth";

// Единая бизнес-таймзона приложения (Preferences.timezone; кладётся в
// localStorage при логине и обновляется на странице настроек). Читаем ПРИ
// КАЖДОМ вызове — значение, захваченное при загрузке модуля, протухает после
// логина или смены настройки до перезагрузки страницы. Дефолт совпадает со
// схемой Preferences и backend/utils/datetime.js.
export const DEFAULT_TIMEZONE = "Europe/Moscow";

const tz = () => getLocalStorageData().timezone || DEFAULT_TIMEZONE;

// Пустое значение — не дата: `new Date(null)` даёт эпоху, и в карточку попадает
// «01.01.1970», а `new Date(undefined)` — «Invalid Date». Поэтому все хелперы
// отображения возвращают null, а вызывающий сам решает, что показать вместо
// даты (обычно `|| "—"`).
const isEmpty = (date) => date === null || date === undefined || date === "";

/* ── Отображение ИНСТАНТОВ (моментов времени) — в бизнес-таймзоне ── */

// «пн, 08.07.2026, 14:30» — канонический формат «дата и время».
export const formatDate = (date) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru", {
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
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru", {
        timeZone: tz(),
        year: "numeric",
        month: "numeric",
        day: "numeric",
      });

// «8 июля в 14:30» — компактный вариант без года («в» подставляет CLDR).
export const formatDateTime = (date) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru", {
        timeZone: tz(),
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

// «пт, 8 июля в 14:30» — с днём недели. Нужен там, где день недели объясняет
// смысл строки: в отчёте по услуге он показывает, почему работа попала в
// нерабочее время (выходной), — без него это надо вычислять в уме.
export const formatWeekdayDateTime = (date) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru", {
        timeZone: tz(),
        weekday: "short",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

// «14:30» — только время инстанта: ленты и логи, где день вынесен отдельной
// меткой (см. businessDayKey ниже).
export const formatTime = (date) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleTimeString("ru", {
        timeZone: tz(),
        hour: "2-digit",
        minute: "2-digit",
      });

// «27 июля» — день и месяц прописью, без года и времени: метки дня над
// группами записей (хроника заявки).
export const formatDayMonthLong = (date) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru", {
        timeZone: tz(),
        day: "numeric",
        month: "long",
      });

// «08.07» — день и месяц без года и времени.
export const formatDayMonth = (date) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru", {
        timeZone: tz(),
        day: "2-digit",
        month: "2-digit",
      });

// «08.07, 14:30» — сверхкомпактный: оси/тултипы графиков и лент.
export const formatDayMonthTime = (date) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleString("ru", {
        timeZone: tz(),
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

/**
 * «июль 2026» из строки «2026-07».
 *
 * Без таймзоны вовсе, и это принципиально: календарный месяц — не момент
 * времени, переводить его в чью-либо зону нельзя. Через `new Date("2026-07-01")`
 * получалась полночь UTC, и в зонах западнее месяц уезжал на предыдущий.
 */
export const formatMonthLabel = (month) => {
  const [year, index] = String(month).split("-").map(Number);
  if (!year || !index) return "";
  return new Date(Date.UTC(year, index - 1, 1)).toLocaleDateString("ru", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
};

// «только что» / «2 мин назад» / «3 ч назад», для старого — полная дата.
// Формат «протухающих» статусов: мониторинг Mikrotik, состояние почтовых
// каналов в настройках (см. ux-ui-guide, «Статус, который протухает»).
export const formatAgo = (value) => {
  if (!value) return null;
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 90 * 1000) return "только что";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} мин назад`;
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / 3600000)} ч назад`;
  }
  return formatDate(value);
};

/**
 * Сколько осталось: «через 12 минут», «через 3 ч». Зеркало `formatAgo` для
 * будущих моментов — срок сеанса подмены и подобные обратные отсчёты.
 * Прошедший момент — «вот-вот»: отрицательные значения в интерфейсе не нужны.
 */
export const formatIn = (value) => {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  if (diff <= 60 * 1000) return "вот-вот";
  if (diff < 60 * 60 * 1000) return `через ${Math.round(diff / 60000)} мин`;
  if (diff < 24 * 60 * 60 * 1000) {
    return `через ${Math.round(diff / 3600000)} ч`;
  }
  return formatDate(value);
};

/* ── Сравнение ДНЕЙ (а не моментов) ── */

/**
 * Календарный день инстанта в бизнес-таймзоне, ключом «2026-07-08».
 *
 * Нужен там, где сравниваются дни, а не моменты («сегодня», «вчера», «эта
 * работа за тот же день»): `date.getDate()` и `toDateString()` берут зону
 * браузера, и сотрудник западнее организации видит «вчера» там, где у компании
 * ещё сегодня. Серверная пара — `toLocaleDateString("en-CA", { timeZone })` в
 * `backend/services/workStatusReset.js` и `dayKey` в telegram-bot.
 */
export const businessDayKey = (date = new Date()) =>
  new Date(date).toLocaleDateString("en-CA", { timeZone: tz() });

/** Разница в календарных днях бизнес-зоны: сегодня → 0, вчера → 1. */
export const businessDaysAgo = (date) => {
  if (isEmpty(date)) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  const midnight = (key) => Date.parse(`${key}T00:00:00Z`);
  return Math.round(
    (midnight(businessDayKey()) - midnight(businessDayKey(parsed))) / 86400000,
  );
};

/* ── КАЛЕНДАРНЫЕ даты (поля «только дата»: покупка, гарантия, срок действия —
      в БД хранятся UTC-полночью) ── */

// Показываем такие поля в UTC, чтобы календарный день не съезжал ни в какой
// таймзоне браузера (для отрицательных смещений локальный рендер даёт «вчера»).
export const formatCalendarDate = (date) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru-RU", { timeZone: "UTC" });

// Значение для app/DateField (контракт <input type="date">): ЛОКАЛЬНЫЙ
// календарный день инстанта.
// НИКОГДА не получайте его через toISOString().split("T")[0] — ISO даёт
// UTC-день, для восточных поясов это «вчера» до смены суток по UTC (при +10 —
// каждое утро до 10:00).
export const toDateInputValue = (date = new Date()) => {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ── Day-key «2026-09-04» (строки календарных периодов и полей-календарей) ── */

// «04.09.2026» из day-key. Без таймзоны и без Date: строка уже является днём,
// переводить её в чью-либо зону нельзя (тот же принцип, что у formatMonthLabel).
// Подписи полей-календарей (app/DateField и др.), бейджи периода в архивах,
// произвольный период в MonthStepper.
export const formatDayKey = (key) => {
  if (isEmpty(key)) return null;
  const [year, month, day] = String(key).split("-");
  if (!year || !month || !day) return null;
  return `${day}.${month}.${year}`;
};

/* ── <input type="datetime-local"> ↔ UTC (симметричная пара в бизнес-таймзоне) ── */

// Настенное время в бизнес-таймзоне строкой «YYYY-MM-DDTHH:mm».
//
// Собираем сами, а не через date-fns/format: toZonedTime уже вернул Date, у
// которого локальные геттеры показывают нужную зону, и остаётся только
// разложить их с ведущими нулями. Конвенция дат (docs/datetime-conventions.md)
// предпочитает Intl и голый JS там, где date-fns не добавляет смысла.
const toWallTime = (date) => {
  const d = toZonedTime(date, tz());
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
};

// Значение для app/DateTimeField (контракт <input type="datetime-local">):
// настенное время инстанта в бизнес-таймзоне. Пара к localToUtc (обратное преобразование при сохранении).
export const toDateTimeLocal = (date = new Date()) =>
  toWallTime(new Date(date));

// То же для ISO-строки с бэка (исторический альяс toDateTimeLocal).
export const utcToLocalForm = (utcDateString) =>
  toWallTime(new Date(utcDateString));

export const localToUtc = (localDateString) => {
  return fromZonedTime(new Date(localDateString), tz()).toISOString();
};

// Сдвиг значения datetime-local на N минут, не выходя из бизнес-таймзоны:
// значение разбирается localToUtc, сдвигается по epoch и печатается обратно
// toDateTimeLocal. Прежний приём (арифметика поверх браузерного
// timeDateInputFormat) держался на том, что зоны разбора и печати взаимно
// сокращаются, и ломался, стоило одной стороне стать зонированной.
export const shiftLocalForm = (localDateString, minutes) => {
  if (!localDateString) {
    return "";
  }

  const shifted = new Date(
    new Date(localToUtc(localDateString)).getTime() + minutes * 60000,
  );

  return toDateTimeLocal(shifted);
};
