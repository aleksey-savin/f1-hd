import type {
  ScheduleDay,
  ScheduleInterval,
  WeekSchedule,
} from "../types/teamSchedule";

const DAY = 1440;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const scheduleForSave = (week: WeekSchedule): WeekSchedule =>
  Object.fromEntries(
    Object.entries(week).map(([key, day]) => {
      if (
        !day.isWorking &&
        day.intervals !== undefined &&
        dayIntervalsError({ ...day, isWorking: true })
      ) {
        const inactive = { ...day };
        delete inactive.intervals;
        return [key, inactive];
      }
      return [key, day];
    }),
  );
const minutes = (time: string) => {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
};

export const dayIntervals = (
  day: ScheduleDay,
  remoteOnly = false,
): ScheduleInterval[] =>
  (
    day.intervals ?? [
      {
        start: day.is24hours ? "00:00" : day.start,
        end: day.is24hours ? "00:00" : day.end,
        place: remoteOnly ? "remote" : "office",
      },
    ]
  ).map((row) => ({
    ...row,
    ...(remoteOnly ? { place: "remote" as const } : {}),
  }));

// Смещения от дня начала смены: хвост после полуночи лежит за 1440.
export const intervalMinutes = (day: ScheduleDay, rows = dayIntervals(day)) => {
  const startOfShift = day.is24hours ? 0 : minutes(day.start);
  return rows.map((row) => {
    const raw = minutes(row.start);
    const start = raw < startOfShift ? raw + DAY : raw;
    let end = minutes(row.end) + (start >= DAY ? DAY : 0);
    if (end <= start) end += DAY;
    return { start, end, place: row.place };
  });
};

export const withIntervals = (
  day: ScheduleDay,
  rows: ScheduleInterval[],
): ScheduleDay => ({
  ...day,
  start: rows[0].start,
  end: rows.at(-1)!.end,
  is24hours: day.is24hours && rows[0].start === rows.at(-1)!.end,
  intervals: rows.map((row) => ({ ...row })),
});

export const changeInterval = (
  day: ScheduleDay,
  index: number,
  patch: Partial<ScheduleInterval>,
): ScheduleDay => {
  const rows = dayIntervals(day);
  rows[index] = { ...rows[index], ...patch };
  if (patch.end !== undefined && rows[index + 1])
    rows[index + 1].start = patch.end;
  return withIntervals(day, rows);
};

export const removeInterval = (
  day: ScheduleDay,
  index: number,
): ScheduleDay => {
  const rows = dayIntervals(day);
  if (rows.length === 1) return day;
  if (index > 0) rows[index - 1].end = rows[index].end;
  else rows[1].start = rows[0].start;
  rows.splice(index, 1);
  return withIntervals(day, rows);
};

export const addPlaceChange = (
  day: ScheduleDay,
  at: string,
  place: ScheduleInterval["place"],
): ScheduleDay => {
  const rows = dayIntervals(day);
  const raw = minutes(at);
  const start = day.is24hours ? 0 : minutes(day.start);
  const point = raw < start ? raw + DAY : raw;
  const index = intervalMinutes(day, rows).findIndex(
    (row) => row.start < point && point < row.end,
  );
  if (index < 0 || rows.length >= 24) return day;
  const end = rows[index].end;
  rows[index].end = at;
  rows.splice(index + 1, 0, { start: at, end, place });
  return withIntervals(day, rows);
};

export const copyScheduleDays = (
  week: WeekSchedule,
  source: string,
  targets: string[],
): WeekSchedule => {
  const copied = { ...week };
  for (const target of targets) copied[target] = structuredClone(week[source]);
  return copied;
};

export const dayIntervalsError = (day: ScheduleDay): string | null => {
  if (!day.isWorking) return null;
  if (
    !day.is24hours &&
    (!TIME.test(day.start) || !TIME.test(day.end) || day.start === day.end)
  ) {
    return "Укажите начало и окончание смены; для суток включите «24 часа».";
  }
  const rows = dayIntervals(day);
  if (!rows.length || rows.length > 24)
    return "В дне должно быть от 1 до 24 интервалов.";
  if (rows.some((row) => !TIME.test(row.start) || !TIME.test(row.end)))
    return "Укажите время каждого интервала.";
  if (rows.some((row) => !["office", "remote"].includes(row.place)))
    return "Выберите место работы для каждого интервала.";
  const start = day.is24hours ? 0 : minutes(day.start);
  const rawEnd = day.is24hours ? 0 : minutes(day.end);
  const end = rawEnd > start ? rawEnd : rawEnd + DAY;
  let cursor = start;
  for (const row of intervalMinutes(day, rows)) {
    if (row.start !== cursor || row.end > end)
      return "Интервалы должны идти подряд, без разрывов и пересечений.";
    cursor = row.end;
  }
  return cursor === end
    ? null
    : "Интервалы должны покрывать весь рабочий день.";
};
