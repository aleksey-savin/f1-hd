import { fromZonedTime } from "date-fns-tz";

import { getLocalStorageData } from "./auth";

// Пояс показа: ЛИЧНЫЙ пояс человека, если он его задал, иначе пояс организации
// (Preferences.timezone), иначе дефолт. Личный пояс — настройка удобства («Мой
// аккаунт → Внешний вид»): на цифры он не влияет никогда, все расчёты сервер
// ведёт в поясе организации и присылает периоды готовыми строками.
//
// Читаем ПРИ КАЖДОМ вызове — значение, захваченное при загрузке модуля,
// протухает после логина, смены настройки или перезагрузки данных корня.
// Дефолт совпадает со схемой Preferences и backend/utils/datetime.js.
export const DEFAULT_TIMEZONE = "Europe/Moscow";

const tz = () => {
  const data = getLocalStorageData();
  return data.personalTimezone || data.timezone || DEFAULT_TIMEZONE;
};

/**
 * Пояс показа — для чистых хелперов, которые форматируют сами и потому берут
 * пояс параметром (util/conversation-format: этот модуль в node --test не
 * грузится — он читает localStorage).
 */
export const displayTimeZone = () => tz();

// Пустое значение — не дата: `new Date(null)` даёт эпоху, и в карточку попадает
// «01.01.1970», а `new Date(undefined)` — «Invalid Date». Поэтому все хелперы
// отображения возвращают null, а вызывающий сам решает, что показать вместо
// даты (обычно `|| "—"`).
const isEmpty = (date) => date === null || date === undefined || date === "";

// Display instants in the personal/organization display timezone.

// Хелперы, которыми пользуется отчёт по услуге, принимают вторым аргументом
// `{ timeZone }`: документ организации показывается в поясе ОРГАНИЗАЦИИ, каким
// бы личным поясом ни пользовался зритель, — в нём отчёт посчитан, и работа
// «в нерабочее время» обязана выглядеть нерабочей (Report/report-zone).
// Аргумент — объект, а не строка: `list.map(formatShortDate)` передаёт вторым
// индекс, и строковый параметр принял бы его за пояс.

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
export const formatShortDate = (date, { timeZone } = {}) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru", {
        timeZone: timeZone || tz(),
        year: "numeric",
        month: "numeric",
        day: "numeric",
      });

// «08.07.2026, 14:30» — компактная дата со временем, без дня недели. Для
// «протухающих» статусов: там важно «когда именно», а день недели съедает
// половину строки и ничего не добавляет.
export const formatShortDateTime = (date) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleString("ru", {
        timeZone: tz(),
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

// «8 июля в 14:30» — компактный вариант без года («в» подставляет CLDR).
export const formatDateTime = (date, { timeZone } = {}) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru", {
        timeZone: timeZone || tz(),
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

// «пт, 8 июля в 14:30» — с днём недели. Нужен там, где день недели объясняет
// смысл строки: в отчёте по услуге он показывает, почему работа попала в
// нерабочее время (выходной), — без него это надо вычислять в уме.
export const formatWeekdayDateTime = (date, { timeZone } = {}) =>
  isEmpty(date)
    ? null
    : new Date(date).toLocaleDateString("ru", {
        timeZone: timeZone || tz(),
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
  // Дальше суток относительный отсчёт перестаёт помогать. Дата со временем, но
  // без дня недели: «пн, 08.07.2026, 14:30» занимает полстроки состояния.
  return formatShortDateTime(value);
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

// Historical name: this is the display-zone day, including the personal override.
// Use organizationDayKey for schedule selection and organization date filters.
export const businessDayKey = (date = new Date()) =>
  new Date(date).toLocaleDateString("en-CA", { timeZone: tz() });

// Business rules and list filters use organization days, ignoring personal display settings.
export const organizationDayKey = (date = new Date(), timeZone) =>
  new Date(date).toLocaleDateString("en-CA", {
    timeZone: timeZone || getLocalStorageData().timezone || DEFAULT_TIMEZONE,
  });

/** Difference in display-zone calendar days: today is 0, yesterday is 1. */
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

// Datetime fields contain wall time in the display zone. Never pass that
// wall time through a browser-local Date: a browser DST gap can normalize it.
const toWallTime = (date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(date)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export const toDateTimeLocal = (date = new Date()) => toWallTime(date);
export const utcToLocalForm = (utcDateString) => toWallTime(utcDateString);
export const localToUtc = (localDateString) =>
  fromZonedTime(localDateString, tz()).toISOString();

// Shift elapsed minutes in the same display zone used for saving.
export const shiftLocalForm = (localDateString, minutes) => {
  if (!localDateString) {
    return "";
  }

  const shifted = new Date(
    new Date(localToUtc(localDateString)).getTime() + minutes * 60000,
  );

  return toDateTimeLocal(shifted);
};
