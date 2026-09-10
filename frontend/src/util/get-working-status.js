import { toZonedTime } from "date-fns-tz";
import { getLocalStorageData } from "./auth";
import { DEFAULT_TIMEZONE } from "./format-date";

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

// Возвращает isOpened/unknown и две формы фразы: `detail` — короткая, для
// tw-строк (WorkStatusText: слово «открыто» рисует компонент, здесь только
// остаток); `verbose` — полная, для легаси-индикатора (WorkingStatusIndicator).
//
// `zone` — часовой пояс клиента (филиала или компании): график «09:00–18:00»
// означает настенное время ТАМ. Без него статус считался в зоне организации и
// для филиала в другом поясе показывал «работает», когда там ночь.
export const getWorkingStatus = (schedule, zone) => {
  if (hasOnlyId(schedule) || schedule === undefined || schedule === null) {
    return {
      isOpened: false,
      unknown: true,
      detail: "график не указан",
      verbose: "график не указан",
    };
  }

  // Без зоны клиента — зона организации. Именно с дефолтом: на пустом
  // localStorage (до логина) toZonedTime(date, undefined) молча берёт зону
  // браузера, и «работает/закрыто» считалось бы не там.
  const timezone = zone || getLocalStorageData().timezone || DEFAULT_TIMEZONE;
  const now = toZonedTime(new Date(), timezone);
  const currentDay = DAYS_OF_WEEK[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const currentTime = now.getHours() * 60 + now.getMinutes();

  // Смена через полночь принадлежит дню, в котором началась, поэтому ночью
  // идёт ВЧЕРАШНЯЯ смена: без этой проверки график 22:00–06:00 показывал
  // «закрыто» всю ночь и бессмысленный обратный отсчёт.
  const previousDay = DAYS_OF_WEEK[(DAYS_OF_WEEK.indexOf(currentDay) + 6) % 7];
  const nightShift = tailOfPreviousDay(schedule[previousDay], currentTime);
  if (nightShift) {
    return {
      isOpened: true,
      detail: `ещё ${formatDuration(nightShift.minutesLeft)}`,
      verbose: `до закрытия ${formatDuration(nightShift.minutesLeft)}`,
    };
  }

  // Check if today is a working day
  if (!schedule[currentDay] || !schedule[currentDay].isWorking) {
    return getNextOpeningTime(schedule, currentDay, now, timezone);
  }

  const todaySchedule = schedule[currentDay];

  // 24-hour schedule check
  if (todaySchedule.is24hours) {
    return {
      isOpened: true,
      detail: "круглосуточно",
      verbose: "работает круглосуточно",
    };
  }

  return getCurrentStatus(
    todaySchedule,
    currentTime,
    schedule,
    currentDay,
    now,
    timezone,
  );
};

const MINUTES_PER_DAY = 24 * 60;

/**
 * Идёт ли ещё вчерашняя смена, ушедшая за полночь. Возвращает остаток до её
 * конца — или null, если вчерашний день нерабочий, круглосуточный либо его
 * окно за полночь не уходило.
 */
function tailOfPreviousDay(daySchedule, currentTime) {
  if (!daySchedule?.isWorking || daySchedule.is24hours) return null;
  if (!daySchedule.start || !daySchedule.end) return null;

  const [startHour, startMinute] = daySchedule.start.split(":").map(Number);
  const [endHour, endMinute] = daySchedule.end.split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN))
    return null;

  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;
  if (endTime >= startTime) return null; // окно не переходило полночь

  return currentTime < endTime ? { minutesLeft: endTime - currentTime } : null;
}

function getCurrentStatus(
  todaySchedule,
  currentTime,
  schedule,
  currentDay,
  now,
  timezone,
) {
  const [startHour, startMinute] = todaySchedule.start.split(":").map(Number);
  const [endHour, endMinute] = todaySchedule.end.split(":").map(Number);
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;

  if (currentTime < startTime) {
    const minutesUntilOpen = startTime - currentTime;
    return {
      isOpened: false,
      detail: `откроется через ${formatDuration(minutesUntilOpen)}`,
      verbose: `откроется через ${formatDuration(minutesUntilOpen)}`,
    };
  }

  // Окно через полночь: конец лежит в следующих сутках
  const endAbsolute = endTime > startTime ? endTime : endTime + MINUTES_PER_DAY;

  if (currentTime >= startTime && currentTime < endAbsolute) {
    const minutesUntilClose = endAbsolute - currentTime;
    return {
      isOpened: true,
      detail: `ещё ${formatDuration(minutesUntilClose)}`,
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
        timezone,
      );
      openingTime.setHours(openHour, openMinute, 0, 0);
      const minutesUntilOpen = Math.round((openingTime - now) / (60 * 1000));

      return {
        isOpened: false,
        detail: `откроется через ${formatDuration(minutesUntilOpen)}`,
        verbose: `откроется через ${formatDuration(minutesUntilOpen)}`,
      };
    }
    daysUntilOpen++;
    nextDayIndex = (nextDayIndex + 1) % 7;
  }

  return {
    isOpened: false,
    detail: "ближайшее открытие не найдено",
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
