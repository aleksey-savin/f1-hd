const { MINUTES_PER_DAY, parseTimeOfDay, windowMinutes } = require("../services/workWindow");

// Интервалы места работы не режут рабочее окно и не меняют норму часов.
// Минуты отсчитываются от дня начала смены, включая её хвост после полуночи.
const workScheduleIntervals = (day, fallbackPlace = "office") => {
  if (!day?.isWorking) return [];
  const window = day.is24hours
    ? { start: 0, end: MINUTES_PER_DAY }
    : windowMinutes(day.start, day.end);
  if (!window) return [];
  if (!day.intervals?.length) return [{ start: window.start, end: window.end, place: fallbackPlace }];
  return day.intervals.map((interval) => {
    const rawStart = parseTimeOfDay(interval.start);
    const rawEnd = parseTimeOfDay(interval.end);
    const start = rawStart < window.start ? rawStart + MINUTES_PER_DAY : rawStart;
    let end = rawEnd + (start >= MINUTES_PER_DAY ? MINUTES_PER_DAY : 0);
    if (end <= start) end += MINUTES_PER_DAY;
    return { start, end, place: interval.place };
  });
};

module.exports = { workScheduleIntervals };
