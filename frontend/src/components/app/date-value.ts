import { formatDayKey } from "../../util/format-date";
import { toIsoDay } from "../../util/period";

// Значения полей-календарей — строки, как у нативных <input type="date"> и
// <input type="datetime-local">: «2026-09-04» и «2026-09-04T14:30». Date живёт
// только внутри компонентов: day-key разбирается ЛОКАЛЬНЫМ конструктором
// (new Date(y, m - 1, d)), а не new Date("2026-09-04") — тот даёт полночь UTC,
// и западнее Гринвича день уезжал бы на вчера (docs/datetime-conventions.md).

export type DayRange = { from: string; to: string };

/** «2026-09-04» → Date локальной полуночи; пусто или мусор → undefined. */
export const parseDayKey = (key?: string | null): Date | undefined => {
  if (!key) return undefined;
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** Date → «2026-09-04» по локальным геттерам (см. util/period). */
export const toDayKey = (date: Date): string => toIsoDay(date);

/** Подпись диапазона: «01.09.2026 – 30.09.2026», незакрытый край — «…». */
export const rangeLabel = ({ from, to }: DayRange): string =>
  from || to
    ? `${from ? formatDayKey(from) : "…"} – ${to ? formatDayKey(to) : "…"}`
    : "";

/** «2026-09-04T14:30» → { day: "2026-09-04", time: "14:30" }. */
export const splitDateTime = (value: string): { day: string; time: string } => {
  const [day = "", time = ""] = value ? value.split("T") : [];
  return { day, time: time.slice(0, 5) };
};

/** Обратно; пока нет обеих частей — «» (как у нативного datetime-local). */
export const joinDateTime = (day: string, time: string): string =>
  day && time ? `${day}T${time}` : "";
