/**
 * Счётные функции для карточки работы.
 *
 * Это ОСТАТОК прежнего расчёта. Деньги отчётов считает сервер —
 * `backend/services/servicePlanBilling.js`, единственный источник истины: пока
 * часы и суммы считал браузер и присылал их скрытыми полями формы, клиент
 * подписывал цифру, посчитанную чьим-то чужим браузером.
 *
 * Здесь остались только те функции, которым сервер не нужен: они показывают
 * переработку и стоимость ОДНОЙ работы прямо в её карточке, пока инженер её
 * заполняет. Ничего нового сюда добавлять не надо — новый расчёт живёт на
 * сервере и приходит готовым.
 */

export const calcSingleWorkOvertime = (schedule, work, tariffingPeriod) => {
  const daysOfWeek = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  const startedAt = new Date(work.startedAt);
  const finishedAt = new Date(work.finishedAt);

  // Если время начала и окончания совпадают, возвращаем 0
  if (startedAt.getTime() === finishedAt.getTime() || work.withinPlan) {
    return {
      actualOvertime: 0,
      roundUpOvertime: 0,
    };
  }

  let currentDate = new Date(
    startedAt.getFullYear(),
    startedAt.getMonth(),
    startedAt.getDate(),
  );
  const endDate = new Date(
    finishedAt.getFullYear(),
    finishedAt.getMonth(),
    finishedAt.getDate(),
  );

  const roundUp = (number, multiple) => {
    return Math.ceil(number / multiple) * multiple;
  };

  let totalOvertime = 0;
  let totalOvertimeRoundUp = 0;

  while (currentDate <= endDate) {
    const dayName = daysOfWeek[(currentDate.getDay() + 6) % 7];
    const daySchedule = schedule[dayName];

    if (daySchedule && daySchedule.isWorking) {
      const [startHour, startMinute] = daySchedule.start.split(":").map(Number);
      const [endHour, endMinute] = daySchedule.end.split(":").map(Number);
      const workStart = new Date(currentDate).setHours(
        startHour,
        startMinute,
        0,
        0,
      );
      const workEnd = new Date(currentDate).setHours(endHour, endMinute, 0, 0);

      const dayStart = new Date(
        Math.max(currentDate.getTime(), startedAt.getTime()),
      );
      const dayEnd = new Date(
        Math.min(
          new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate(),
            23,
            59,
            59,
            999,
          ),
          finishedAt.getTime(),
        ),
      );

      // Переработка до начала рабочего дня
      if (dayStart < new Date(workStart)) {
        const overtime = Math.min(
          new Date(workStart) - dayStart,
          dayEnd - dayStart,
        );

        totalOvertime += overtime;
        totalOvertimeRoundUp += roundUp(overtime, tariffingPeriod * 60 * 1000);
      }

      // Переработка после окончания рабочего дня
      if (dayEnd > new Date(workEnd)) {
        const overtime = dayEnd - Math.max(new Date(workEnd), dayStart);
        totalOvertime += overtime;
        totalOvertimeRoundUp += roundUp(overtime, tariffingPeriod * 60 * 1000);
      }
    } else {
      // Если день нерабочий, все время считается переработкой
      const dayStart = new Date(
        Math.max(currentDate.getTime(), startedAt.getTime()),
      );
      const dayEnd = new Date(
        Math.min(
          new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate(),
            23,
            59,
            59,
            999,
          ),
          finishedAt.getTime(),
        ),
      );
      totalOvertime += dayEnd - dayStart;
      totalOvertimeRoundUp += roundUp(
        dayEnd - dayStart,
        tariffingPeriod * 60 * 1000,
      );
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // return overtime in milliseconds
  return {
    actualOvertime: totalOvertime,
    roundUpOvertime: totalOvertimeRoundUp,
  };
};


export const formatOvertimeMinutes = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} часов ${remainingMinutes} минут`;
};


export const calculateCost = (durationMinutes, hourlyRate, billingPeriod) => {
  // Округляем длительность вверх до ближайшего периода тарификации
  const roundedDuration =
    Math.ceil(durationMinutes / billingPeriod) * billingPeriod;

  // Рассчитываем стоимость
  // (длительность в минутах / 60 минут) * часовая ставка
  const cost = (roundedDuration / 60) * hourlyRate;

  return cost;
};
