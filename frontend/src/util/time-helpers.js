import pad from "pad";

export const msToHMS = (ms) => {
  // 1- Convert to seconds:
  let seconds = ms / 1000;
  // 2- Extract hours:
  const hours = parseInt(seconds / 3600); // 3,600 seconds in 1 hour
  seconds = seconds % 3600; // seconds remaining after extracting hours
  // 3- Extract minutes:
  const minutes = parseInt(seconds / 60); // 60 seconds in 1 minute
  // 4- Keep only seconds not extracted to minutes:
  seconds = seconds % 60;

  const humanized =
    [pad(2, hours.toString(), "0"), pad(2, minutes.toString(), "0")].join(":") +
    " ч.";

  return humanized;
};

export const getNextCronDate = (cronExpression, currentDate = new Date()) => {
  // Разбираем cron выражение
  const [minute, hour, dayOfMonth, month, dayOfWeek] =
    cronExpression.split(" ");

  let nextDate = new Date(currentDate);

  // Округляем до следующей минуты
  nextDate.setSeconds(0);
  nextDate.setMilliseconds(0);
  nextDate.setMinutes(nextDate.getMinutes() + 1);

  while (true) {
    // Проверяем соответствие всем частям cron-выражения
    if (
      checkCronPart(minute, nextDate.getMinutes()) &&
      checkCronPart(hour, nextDate.getHours()) &&
      checkCronPart(dayOfMonth, nextDate.getDate()) &&
      checkCronPart(month, nextDate.getMonth() + 1) &&
      checkCronPart(dayOfWeek, nextDate.getDay())
    ) {
      return nextDate;
    }

    // Если не соответствует, переходим к следующей минуте
    nextDate.setMinutes(nextDate.getMinutes() + 1);
  }
};

function checkCronPart(cronPart, dateValue) {
  if (cronPart === "*") return true;

  const values = cronPart
    .split(",")
    .map((part) => {
      if (part.includes("-")) {
        const [start, end] = part.split("-").map(Number);
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      }
      if (part.includes("/")) {
        const [start, step] = part.split("/");
        const max =
          start === "*" ? (cronPart === "0" ? 59 : 23) : parseInt(start);
        return Array.from(
          { length: Math.floor(max / parseInt(step)) + 1 },
          (_, i) => i * parseInt(step)
        );
      }
      return parseInt(part);
    })
    .flat();

  return values.includes(dateValue);
}
