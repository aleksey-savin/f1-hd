/**
 * Окно рабочего дня: единственное место, где разбирается пара `{start, end}`
 * недельного графика.
 *
 * Копий этого разбора было три — в `workCalendar.dayPlan`, в
 * `workOvertime.staticDayPlanner` и в `servicePlanBilling.dayWindow`, — и
 * guard на `end <= start` стоял только в первой. Две другие молча считали
 * куски «до окна» и «после окна» перекрывающимися: ночная смена 22:00–06:00
 * давала ноль оплачиваемого времени и сутки переработки, а работа длиной в
 * сутки — сорок часов переработки из двадцати четырёх.
 *
 * Модуль намеренно листовой (dayjs + services/dateKeys): `workCalendar` тянет
 * mongoose и логгер, а `servicePlanBilling` на него не завязан осознанно
 * (см. docs/datetime-conventions.md — «порт для биллинга, а не источник»).
 *
 * ОКНО ЧЕРЕЗ ПОЛНОЧЬ. `end < start` означает, что смена уходит в следующие
 * сутки: 22:00–06:00 — это `[22:00 D, 06:00 D+1)`. Окно принадлежит целиком
 * тому дню, в котором НАЧАЛОСЬ: пятничная ночная смена — хвост пятницы, а не
 * работа в субботу, и коэффициента выходного на неё не бывает. Длина окна
 * всегда меньше суток, поэтому окно достаёт до `D+1` и никогда до `D+2`.
 *
 * `end === start` — НУЛЕВОЕ окно, а не круглосуточное. В проде есть тариф, у
 * которого все семь дней стоят `00:00–00:00`, и это осознанное «окна нет, всё
 * переработка»; прочитать его как сутки значит перевернуть счёт клиенту.
 * Круглосуточный день заявляется флагом `is24hours`.
 */

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const { pad, keyToUtc, toDateKey } = require("@/services/dateKeys");

const MINUTES_PER_DAY = 24 * 60;

// Индекс дня недели → ключ графика; (dow + 6) % 7 даёт понедельник = 0
const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** «HH:mm» → минуты от полуночи; null у всего, что не разобралось. */
const parseTimeOfDay = (value) => {
  if (typeof value !== "string" || !value.includes(":")) {
    return null;
  }
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
};

/** Ключ даты → имя дня недели в графике. */
const dayNameOfKey = (dateKey) => {
  const dow = keyToUtc(dateKey).getUTCDay();
  return DAYS_OF_WEEK[(dow + 6) % 7];
};

/** Сдвиг ключа календарной даты на сутки. */
const shiftDayKey = (dateKey, delta) => {
  const date = keyToUtc(dateKey);
  date.setUTCDate(date.getUTCDate() + delta);
  return toDateKey(date);
};

/**
 * Окно дня в минутах от его полуночи.
 *
 * `end` МОНОТОНЕН и может превышать 1440 — так все существующие `end - start`
 * и «сколько минут от полуночи» остаются осмысленными. Флаг-альтернатива
 * («end в пределах суток плюс crossesMidnight») молча компилируется в каждом
 * месте, где про флаг забыли, — именно так этот класс ошибок и расползается.
 *
 * null — окна нет: время не разобралось или оно нулевое.
 */
const windowMinutes = (start, end) => {
  const from = parseTimeOfDay(start);
  const to = parseTimeOfDay(end);
  if (from === null || to === null) {
    return null;
  }

  const length = to > from ? to - from : to < from ? to + MINUTES_PER_DAY - from : 0;
  if (length === 0) {
    return null;
  }

  return { start: from, end: from + length, length };
};

/**
 * Момент времени по ключу даты и смещению в минутах.
 *
 * ЕДИНСТВЕННЫЙ законный способ получить инстант из графика. `полночь + N минут`
 * и `cursor.hour(H)` запрещены: dayjs наследует замороженное смещение пояса, и
 * после перехода на летнее время каждый следующий день цикла уезжает на час —
 * навсегда. Российские зоны переходов не имеют, но `Company.timezone` — поле
 * свободного ввода, и оно течёт прямо в счёт.
 */
const instantOf = (dateKey, minutes, zone) => {
  const dayShift = Math.floor(minutes / MINUTES_PER_DAY);
  const withinDay = minutes - dayShift * MINUTES_PER_DAY;
  const key = dayShift ? shiftDayKey(dateKey, dayShift) : dateKey;
  const hours = Math.floor(withinDay / 60);

  return dayjs
    .tz(`${key} ${pad(hours)}:${pad(withinDay % 60)}`, zone)
    .valueOf();
};

/**
 * Окна графика, покрывающие период, — отсортированные и непересекающиеся.
 *
 * Пересечение окон соседних дней — ошибка данных, а не расписание: на двух
 * сменах разом никто не стоит. Валидация не даёт такое сохранить, а здесь, на
 * старых данных, побеждает окно с более ранним началом — поздний сосед
 * подрезается с головы. Для денег всегда используется ОБЪЕДИНЕНИЕ окон,
 * поэтому минута не может быть учтена дважды ни при каких данных.
 *
 * `dayPlanFor(dateKey)` — план дня (`workCalendar.planner.dayPlan` либо
 * статический планировщик биллинга); дни без окна пропускаются.
 */
const buildWindows = (dayPlanFor, fromKey, toKey, zone) => {
  const windows = [];

  for (let key = fromKey; key <= toKey; key = shiftDayKey(key, 1)) {
    const plan = dayPlanFor(key);
    if (!plan || plan.start === null || plan.end === null) {
      continue;
    }
    const from = instantOf(key, plan.start, zone);
    const to = instantOf(key, plan.end, zone);
    if (to > from) {
      windows.push({ from, to });
    }
  }

  windows.sort((a, b) => a.from - b.from);

  const merged = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.from < previous.to) {
      previous.to = Math.max(previous.to, window.to);
    } else {
      merged.push({ ...window });
    }
  }

  return merged;
};

/** Куски интервала, не накрытые ни одним окном. */
const subtractWindows = ([from, to], windows) => {
  const chunks = [];
  let cursor = from;

  for (const window of windows) {
    if (window.to <= cursor) continue;
    if (window.from >= to) break;
    if (window.from > cursor) {
      chunks.push([cursor, Math.min(window.from, to)]);
    }
    cursor = Math.max(cursor, window.to);
    if (cursor >= to) break;
  }

  if (cursor < to) {
    chunks.push([cursor, to]);
  }

  return chunks;
};

/** Куски интервала, накрытые окнами. Зеркало subtractWindows. */
const intersectWindows = ([from, to], windows) => {
  const chunks = [];

  for (const window of windows) {
    const start = Math.max(from, window.from);
    const end = Math.min(to, window.to);
    if (end > start) {
      chunks.push([start, end]);
    }
  }

  return chunks;
};

module.exports = {
  MINUTES_PER_DAY,
  DAYS_OF_WEEK,
  parseTimeOfDay,
  dayNameOfKey,
  shiftDayKey,
  windowMinutes,
  instantOf,
  buildWindows,
  subtractWindows,
  intersectWindows,
};
