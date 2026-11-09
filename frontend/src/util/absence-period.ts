export type AbsenceTimeRange = { start: string; end: string };
export type AbsencePeriod = {
  from: string;
  to: string;
  timeRange?: AbsenceTimeRange | null;
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const clockMinutes = (clock: string) => {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
};

/** Настенные часы организации; конец раньше начала означает следующий день. */
export const absenceDurationMinutes = (
  range: AbsenceTimeRange | null | undefined,
): number | null => {
  if (!range || !CLOCK.test(range.start) || !CLOCK.test(range.end)) return null;
  const duration = clockMinutes(range.end) - clockMinutes(range.start);
  if (duration === 0) return null;
  return duration < 0 ? duration + 1440 : duration;
};

export const absencePeriodError = (period: AbsencePeriod): string | null => {
  if (!period.from || !period.to) return "Выберите дату отсутствия";
  if (period.to < period.from) return "Дата окончания раньше даты начала";
  if (period.timeRange) {
    if (period.from !== period.to) return "Для части дня выберите одну дату";
    if (absenceDurationMinutes(period.timeRange) === null) {
      return "Укажите время начала и окончания; они должны различаться";
    }
  }
  return null;
};

export const formatAbsenceDuration = (minutes: number): string =>
  [
    Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} ч` : "",
    minutes % 60 ? `${minutes % 60} мин` : "",
  ]
    .filter(Boolean)
    .join(" ");

/** Форматтер даты передаётся из util/format-date: хелпер не читает настройки браузера. */
export const formatAbsencePeriod = (
  period: AbsencePeriod,
  formatDate: (key: string) => string | null,
): string => {
  const from = formatDate(period.from) ?? "";
  if (period.timeRange) {
    const { start, end } = period.timeRange;
    return `${from} · ${start}–${end}${end < start ? " +1" : ""}`;
  }
  return period.from === period.to
    ? from
    : `${from} — ${formatDate(period.to) ?? ""}`;
};

export const formatAbsenceScheduleWindow = (window: {
  start: number;
  end: number;
  crossesMidnight: boolean;
}): string => {
  const clock = (minutes: number) => {
    const withinDay = minutes % 1440;
    return `${String(Math.floor(withinDay / 60)).padStart(2, "0")}:${String(withinDay % 60).padStart(2, "0")}`;
  };
  return `${clock(window.start)}–${clock(window.end)}${window.crossesMidnight ? " +1" : ""}`;
};
