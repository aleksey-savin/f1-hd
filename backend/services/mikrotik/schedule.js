const {
  formatInTimeZone,
  fromZonedTime,
  toZonedTime,
} = require("date-fns-tz");

const { DEFAULT_TIMEZONE } = require("../../utils/datetime");

// Backups/exports use friendly presets (off / daily / weekly / monthly) with a
// wall-clock time in the operator's timezone. We store a cached nextRunAt (a UTC
// Date) that the scheduler tick compares against, recomputed after each run and
// whenever the schedule is edited.

const pad2 = (value) => String(value).padStart(2, "0");

// Computes the next fire instant (a UTC Date) for a preset schedule, interpreting
// `time` (HH:MM) and the weekday / day-of-month in the given timezone. Returns
// null for a disabled ("off") or malformed schedule.
const computeNextRun = (
  schedule,
  from = new Date(),
  timeZone = DEFAULT_TIMEZONE,
) => {
  if (!schedule || !schedule.frequency || schedule.frequency === "off") {
    return null;
  }

  const tz = timeZone || DEFAULT_TIMEZONE;
  const [hh, mm] = String(schedule.time || "03:00")
    .split(":")
    .map(Number);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) {
    return null;
  }

  // Walk forward day-by-day over tz calendar dates (stepped as UTC midnights so a
  // DST transition never skips/duplicates a calendar date) and return the first
  // future slot that matches the frequency.
  const todayStr = formatInTimeZone(from, tz, "yyyy-MM-dd");
  const [year, month, day] = todayStr.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day);

  for (let i = 0; i <= 366; i++) {
    const cursor = new Date(base + i * 86400000);
    const dateStr = `${cursor.getUTCFullYear()}-${pad2(
      cursor.getUTCMonth() + 1,
    )}-${pad2(cursor.getUTCDate())}`;
    const candidate = fromZonedTime(`${dateStr} ${pad2(hh)}:${pad2(mm)}:00`, tz);
    if (candidate.getTime() <= from.getTime()) {
      continue;
    }

    if (schedule.frequency === "daily") {
      return candidate;
    }

    const zoned = toZonedTime(candidate, tz);
    if (
      schedule.frequency === "weekly" &&
      zoned.getDay() === Number(schedule.weekday)
    ) {
      return candidate;
    }
    if (
      schedule.frequency === "monthly" &&
      zoned.getDate() === Number(schedule.dayOfMonth)
    ) {
      return candidate;
    }
  }

  return null;
};

module.exports = { computeNextRun, DEFAULT_TIMEZONE };
