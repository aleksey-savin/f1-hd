const Work = require("@/models/work");
const { Ticket } = require("@/models/ticket");

const {
  classifyWork,
  toMinutes,
  workDurationMs,
} = require("@/services/workSummary");
const {
  buildOvertimeContext,
  isExcludedFromOvertime,
  overtimeForWork,
} = require("@/services/workOvertime");
const {
  buildScheduleContext,
  makePlanner,
} = require("@/services/workCalendar");
const { filterApprovedWorks } = require("@/services/approvedWorks");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Помесячная динамика работ — одна на персональный отчёт и на режим «Динамика»
 * отчёта «Сотрудники». Раньше жила внутри personalReportService и умела только
 * одного сотрудника; команда — тот же расчёт с набором сотрудников, поэтому
 * функция вынесена сюда, а не скопирована.
 *
 * Одна выборка на весь год + группировка в памяти; переработки считает общий
 * workOvertime (планировщик на каждого сотрудника, контекст графиков — один на
 * всех). Классы работ требуют populate `routineTask`; персональному тренду они
 * не нужны, поэтому включаются флагом `withClasses`.
 */

const emptyMonth = (withClasses) => ({
  minutes: 0,
  overtimeMinutes: 0,
  worksCount: 0,
  ...(withClasses
    ? {
        ticketsFinished: 0,
        onSite: { count: 0, minutes: 0 },
        remote: { count: 0, minutes: 0 },
        routineTask: { count: 0, minutes: 0 },
      }
    : {}),
});

const buildMonthlyWorkTrend = async ({
  users,
  anchorDay,
  months = 12,
  tz,
  overtimeSettings,
  preferences,
  withClasses = false,
  perUser = false,
  countTickets = false,
  approvedOnly = false,
}) => {
  const lastMonth = anchorDay.startOf("month");
  const firstMonth = lastMonth.subtract(months - 1, "month");
  const fromDate = firstMonth.startOf("month").toDate();
  const toDate = lastMonth.endOf("month").toDate();

  const userIds = users.map((user) => user._id.toString());

  const cursor = Work.find({
    "finishedBy._id": { $in: userIds },
    finishedAt: { $gte: fromDate, $lte: toDate },
  })
    .select("company visitRequired startedAt finishedAt finishedBy tickets")
    .populate("company", "alias workSchedule servicePlans");

  if (withClasses) {
    cursor.populate({
      path: "tickets",
      select: "categoryId routineTask",
      populate: { path: "routineTask", select: "_id" },
    });
  } else {
    cursor.populate({ path: "tickets", select: "categoryId" });
  }

  const loaded = await cursor.lean();
  // Переключатель «только согласованные работы» один на весь отчёт, поэтому
  // действует и на динамику
  const works = approvedOnly
    ? await filterApprovedWorks(loaded, { fromDate, toDate })
    : loaded;

  const { categoriesById } = await buildOvertimeContext(works);

  const scheduleContext = await buildScheduleContext({
    fromKey: firstMonth.format("YYYY-MM-DD"),
    toKey: lastMonth.endOf("month").format("YYYY-MM-DD"),
    userIds,
    preferences,
  });

  const monthKeys = [];
  for (let cur = firstMonth; cur.valueOf() <= lastMonth.valueOf(); cur = cur.add(1, "month")) {
    monthKeys.push({
      month: cur.format("YYYY-MM"),
      label: cur.toDate().toLocaleDateString("ru-RU", {
        timeZone: tz,
        year: "numeric",
        month: "long",
      }),
    });
  }

  const totals = new Map(
    monthKeys.map((item) => [item.month, { ...item, ...emptyMonth(withClasses) }]),
  );
  const byUser = new Map();

  const plannerByUser = new Map(
    users.map((user) => [
      user._id.toString(),
      makePlanner(user, scheduleContext, overtimeSettings),
    ]),
  );

  for (const work of works) {
    const userId = work.finishedBy?._id?.toString();
    const planner = userId ? plannerByUser.get(userId) : null;
    if (!planner) {
      continue;
    }

    const monthKey = dayjs(work.finishedAt).tz(tz).format("YYYY-MM");
    const monthTotals = totals.get(monthKey);
    if (!monthTotals) {
      continue;
    }

    const minutes = toMinutes(workDurationMs(work));
    let overtimeMinutes = 0;

    if (!isExcludedFromOvertime(work, categoriesById) && work.startedAt && work.finishedAt) {
      const { overtime } = overtimeForWork(work, {
        planner,
        overtimeSettings,
        orgTz: tz,
      });
      overtimeMinutes = toMinutes(overtime.roundedMs);
    }

    monthTotals.minutes += minutes;
    monthTotals.overtimeMinutes += overtimeMinutes;
    monthTotals.worksCount += 1;

    if (withClasses) {
      const classKey = classifyWork(work);
      monthTotals[classKey].count += 1;
      monthTotals[classKey].minutes += minutes;
    }

    if (perUser) {
      if (!byUser.has(userId)) {
        byUser.set(
          userId,
          new Map(monthKeys.map((item) => [item.month, { ...item, ...emptyMonth(false) }])),
        );
      }
      const userMonth = byUser.get(userId).get(monthKey);
      userMonth.minutes += minutes;
      userMonth.overtimeMinutes += overtimeMinutes;
      userMonth.worksCount += 1;
    }
  }

  // Закрытые заявки по месяцам — отдельным лёгким агрегатом (у работы может
  // быть несколько заявок, суммировать их по работам нельзя)
  if (countTickets) {
    const ticketRows = await Ticket.aggregate([
      {
        $match: {
          finishedBy: { $ne: null },
          finishedAt: { $gte: fromDate, $lte: toDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { date: "$finishedAt", format: "%Y-%m", timezone: tz },
          },
          count: { $sum: 1 },
        },
      },
    ]);
    for (const row of ticketRows) {
      const monthTotals = totals.get(row._id);
      if (monthTotals) {
        monthTotals.ticketsFinished = row.count;
      }
    }
  }

  return {
    months: [...totals.values()],
    byUser: perUser
      ? [...byUser.entries()].map(([userId, monthsMap]) => ({
          userId,
          months: [...monthsMap.values()],
        }))
      : [],
  };
};

module.exports = { buildMonthlyWorkTrend };
