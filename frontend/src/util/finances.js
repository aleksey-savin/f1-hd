export const filterUnrelatedWorks = (works, tickets, servicePlans) => {
  const unrelatedWorks = works.filter((work) =>
    work.tickets.some((workTicket) =>
      tickets.find(
        (ticket) =>
          ticket._id === workTicket._id &&
          !servicePlans.some((servicePlan) =>
            servicePlan.ticketCategories
              .map((category) => category._id.toString())
              .includes(ticket.categoryId?.toString()),
          ),
      ),
    ),
  );

  return unrelatedWorks;
};

export const calculateTotalWorkTime = (works, tariffingPeriod) => {
  let totalWorktime = 0;

  for (let work of works) {
    const startedAt = new Date(work.startedAt);
    const finishedAt = new Date(work.finishedAt);
    totalWorktime += finishedAt.getTime() - startedAt.getTime();
  }

  totalWorktime =
    Math.ceil(totalWorktime / (tariffingPeriod * 60 * 1000)) *
    (tariffingPeriod * 60 * 1000);

  return totalWorktime;
};

export const calculateWorkTime = (schedule, works, tariffingPeriod) => {
  let worktime = 0;
  let roundedWorktime = 0;
  let worktimeWorks = [];
  for (let work of works) {
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

    // If start and end times are the same, skip this work
    if (work.startedAt === work.finishedAt) {
      continue;
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
    let totalWorkTime = 0;

    if (work.withinPlan) {
      // If work is within plan, count the entire duration as work time
      totalWorkTime = finishedAt.getTime() - startedAt.getTime();
    } else {
      while (currentDate <= endDate) {
        const dayName = daysOfWeek[(currentDate.getDay() + 6) % 7];
        const daySchedule = schedule[dayName];

        if (daySchedule && daySchedule.isWorking) {
          const [startHour, startMinute] = daySchedule.start
            .split(":")
            .map(Number);
          const [endHour, endMinute] = daySchedule.end.split(":").map(Number);
          const workStart = new Date(currentDate).setHours(
            startHour,
            startMinute,
            0,
            0,
          );
          const workEnd = new Date(currentDate).setHours(
            endHour,
            endMinute,
            0,
            0,
          );

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

          // Calculate work time within working hours
          const effectiveStart = Math.max(dayStart.getTime(), workStart);
          const effectiveEnd = Math.min(dayEnd.getTime(), workEnd);

          if (effectiveEnd > effectiveStart) {
            totalWorkTime += effectiveEnd - effectiveStart;
          }
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    worktime += Math.round(totalWorkTime / (1000 * 60));

    // Round up each work item's time according to tariffing period
    const roundedTotalWorkTime =
      Math.ceil(totalWorkTime / (tariffingPeriod * 60 * 1000)) *
      (tariffingPeriod * 60 * 1000);
    roundedWorktime += Math.round(roundedTotalWorkTime / (1000 * 60));

    if (totalWorkTime > 0) {
      // Calculate actual work time boundaries
      let actualWorkStartTime = null;
      let actualWorkEndTime = null;

      if (work.withinPlan) {
        // If work is within plan, use original times
        actualWorkStartTime = startedAt;
        actualWorkEndTime = finishedAt;
      } else {
        // Calculate actual work time boundaries within working hours
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

        while (currentDate <= endDate) {
          const dayName = daysOfWeek[(currentDate.getDay() + 6) % 7];
          const daySchedule = schedule[dayName];

          if (daySchedule && daySchedule.isWorking) {
            const [startHour, startMinute] = daySchedule.start
              .split(":")
              .map(Number);
            const [endHour, endMinute] = daySchedule.end.split(":").map(Number);
            const workStart = new Date(currentDate).setHours(
              startHour,
              startMinute,
              0,
              0,
            );
            const workEnd = new Date(currentDate).setHours(
              endHour,
              endMinute,
              0,
              0,
            );

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

            // Calculate work time within working hours
            const effectiveStart = Math.max(dayStart.getTime(), workStart);
            const effectiveEnd = Math.min(dayEnd.getTime(), workEnd);

            if (effectiveEnd > effectiveStart) {
              if (actualWorkStartTime === null) {
                actualWorkStartTime = new Date(effectiveStart);
              }
              actualWorkEndTime = new Date(effectiveEnd);
            }
          }

          currentDate.setDate(currentDate.getDate() + 1);
        }
      }

      // Create modified work object with actual work time boundaries
      const modifiedWork = {
        ...work,
        startedAt: actualWorkStartTime
          ? actualWorkStartTime.toISOString()
          : work.startedAt,
        finishedAt: actualWorkEndTime
          ? actualWorkEndTime.toISOString()
          : work.finishedAt,
      };

      worktimeWorks.push(modifiedWork);
    }
  }
  return { worktime, roundedWorktime, worktimeWorks };
};

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

export const calculateOvertime = (schedule, works, tariffingPeriod) => {
  let overtime = 0;
  let overtimeWorks = [];

  for (let work of works) {
    if (work.startedAt === work.finishedAt) {
      continue;
    }
    const totalOvertime = calcSingleWorkOvertime(
      schedule,
      work,
      tariffingPeriod,
    ).roundUpOvertime;

    overtime += totalOvertime / (1000 * 60);
    if (totalOvertime > 0 && !work.withinPlan) {
      overtimeWorks.push(work);
    }
  }

  return { overtime: overtime, overtimeWorks: overtimeWorks };
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

export const calcSingleWorkTime = (work, tariffingPeriodMinutes) => {
  // Calculate actual work duration in milliseconds
  const actualDuration = new Date(work.finishedAt) - new Date(work.startedAt);

  // Convert tariffing period from minutes to milliseconds
  const tariffingPeriodMs = tariffingPeriodMinutes * 60 * 1000;

  // Round up to the nearest tariffing period
  const roundedUpDuration =
    Math.ceil(actualDuration / tariffingPeriodMs) * tariffingPeriodMs;

  return {
    actualDuration,
    roundedUpDuration,
  };
};

export const calcRoundedWorkTime = (work, tariffingPeriodMinutes) => {
  return calcSingleWorkTime(work, tariffingPeriodMinutes).roundedUpDuration;
};

export const overallRoundedWorktime = (works, tariffingPeriodMinutes) => {
  let totalRoundedWorktime = 0;
  for (let work of works) {
    totalRoundedWorktime += calcRoundedWorkTime(work, tariffingPeriodMinutes);
  }
  return totalRoundedWorktime;
};
