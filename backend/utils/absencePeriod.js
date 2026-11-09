const { dayKeyToUtcMidnight } = require("./datetime");
const { windowMinutes, shiftDayKey, MINUTES_PER_DAY } = require("../services/workWindow");

const CLOCK_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const keyOf = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value;

// Настенное время в поясе организации. Отсутствующее поле и null — целые дни.
const validateAbsenceTimeRange = (timeRange, from, to) => {
  if (timeRange === undefined || timeRange === null) return true;
  if (typeof timeRange !== "object" || Array.isArray(timeRange) ||
      typeof timeRange.start !== "string" || typeof timeRange.end !== "string" ||
      !CLOCK_RE.test(timeRange.start) || !CLOCK_RE.test(timeRange.end)) {
    throw new Error("Укажите начало и окончание отсутствия в формате ЧЧ:ММ");
  }
  if (keyOf(from) !== keyOf(to)) throw new Error("Отсутствие на часть дня задаётся на одну дату");
  if (timeRange.start === timeRange.end) throw new Error("Начало и окончание отсутствия не должны совпадать");
  return true;
};

// Это ось календарных минут, а не инстанты: общий пояс у всех отсутствий.
// Полуоткрытые окна разрешают отсутствия, которые примыкают друг к другу.
const bounds = ({ from, to, timeRange }) => {
  const base = dayKeyToUtcMidnight(keyOf(from)).valueOf() / 60000;
  if (timeRange) {
    const window = windowMinutes(timeRange.start, timeRange.end);
    return { start: base + window.start, end: base + window.end };
  }
  return { start: base, end: dayKeyToUtcMidnight(keyOf(to)).valueOf() / 60000 + MINUTES_PER_DAY };
};

const absencePeriodsOverlap = (left, right) => {
  const a = bounds(left);
  const b = bounds(right);
  return a.start < b.end && b.start < a.end;
};

const absenceSearchBounds = ({ from, to }) => ({
  from: dayKeyToUtcMidnight(shiftDayKey(keyOf(from), -1)),
  to: dayKeyToUtcMidnight(shiftDayKey(keyOf(to), 1)),
});

const formatAbsencePeriod = ({ from, to, timeRange }) => {
  const fromKey = keyOf(from);
  const toKey = keyOf(to);
  const display = (key) => key.split("-").reverse().join(".");
  if (timeRange) {
    return `${display(fromKey)}, ${timeRange.start}–${timeRange.end}${timeRange.end < timeRange.start ? " +1" : ""}`;
  }
  return fromKey === toKey ? display(fromKey) : `${display(fromKey)} — ${display(toKey)}`;
};

const absenceDurationMinutes = (timeRange) => windowMinutes(timeRange.start, timeRange.end).length;

module.exports = { validateAbsenceTimeRange, absencePeriodsOverlap, absenceSearchBounds, formatAbsencePeriod, absenceDurationMinutes };
