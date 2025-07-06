import { toZonedTime } from "date-fns-tz";
import { getLocalStorageData } from "./auth";

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const getWorkingStatus = (schedule) => {
  if (hasOnlyId(schedule) || schedule === undefined || schedule === null) {
    return {
      isOpened: false,
      verbose: "расписание не указано",
    };
  }

  const { timezone } = getLocalStorageData();
  const now = toZonedTime(new Date(), timezone);
  const currentDay = DAYS_OF_WEEK[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const currentTime = now.getHours() * 60 + now.getMinutes();

  // Check if today is a working day
  if (!schedule[currentDay] || !schedule[currentDay].isWorking) {
    return getNextOpeningTime(schedule, currentDay, now, timezone);
  }

  const todaySchedule = schedule[currentDay];

  // 24-hour schedule check
  if (todaySchedule.is24hours) {
    return {
      isOpened: true,
      verbose: "работает круглосуточно",
    };
  }

  return getCurrentStatus(
    todaySchedule,
    currentTime,
    schedule,
    currentDay,
    now,
    timezone
  );
};

function getCurrentStatus(
  todaySchedule,
  currentTime,
  schedule,
  currentDay,
  now,
  timezone
) {
  const [startHour, startMinute] = todaySchedule.start.split(":").map(Number);
  const [endHour, endMinute] = todaySchedule.end.split(":").map(Number);
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;

  if (currentTime < startTime) {
    const minutesUntilOpen = startTime - currentTime;
    return {
      isOpened: false,
      verbose: `откроется через ${formatDuration(minutesUntilOpen)}`,
    };
  }

  if (currentTime >= startTime && currentTime < endTime) {
    const minutesUntilClose = endTime - currentTime;
    return {
      isOpened: true,
      verbose: `до закрытия ${formatDuration(minutesUntilClose)}`,
    };
  }

  return getNextOpeningTime(schedule, currentDay, now, timezone);
}

function getNextOpeningTime(schedule, currentDay, now, timezone) {
  let daysUntilOpen = 1;
  let nextDayIndex = (DAYS_OF_WEEK.indexOf(currentDay) + 1) % 7;

  while (daysUntilOpen <= 7) {
    const nextDayName = DAYS_OF_WEEK[nextDayIndex];
    if (schedule[nextDayName]?.isWorking) {
      const [openHour, openMinute] = schedule[nextDayName].start
        .split(":")
        .map(Number);
      const openingTime = toZonedTime(
        new Date(now.getTime() + daysUntilOpen * 24 * 60 * 60 * 1000),
        timezone
      );
      openingTime.setHours(openHour, openMinute, 0, 0);
      const minutesUntilOpen = Math.round((openingTime - now) / (60 * 1000));

      return {
        isOpened: false,
        verbose: `откроется через ${formatDuration(minutesUntilOpen)}`,
      };
    }
    daysUntilOpen++;
    nextDayIndex = (nextDayIndex + 1) % 7;
  }

  return {
    isOpened: false,
    verbose: "информация о следующем рабочем дне не найдена",
  };
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  let result = "";

  if (hours > 0) {
    result += `${hours} ч `;
  }
  if (remainingMinutes > 0 || hours === 0) {
    result += `${remainingMinutes} мин`;
  }

  return result.trim();
}

function hasOnlyId(obj) {
  const keys = obj ? Object.keys(obj) : [];
  return keys.length === 1 && keys[0] === "_id";
}
