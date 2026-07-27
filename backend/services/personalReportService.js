const Work = require("@/models/work");
const { Ticket } = require("@/models/ticket");

const { resolveTimezone } = require("@/utils/datetime");
const {
  MS_PER_MINUTE,
  classifyWork,
  splitIntoDaySegments,
  toMinutes,
  workDurationMs,
} = require("@/services/workSummary");
const {
  buildOvertimeContext,
  buildPayroll,
  emptyOvertime,
  isExcludedFromOvertime,
  overtimeForWork,
  resolveOvertimeSettings,
} = require("@/services/workOvertime");
const {
  buildScheduleContext,
  makePlanner,
} = require("@/services/workCalendar");
const { buildMonthlyWorkTrend } = require("@/services/monthlyWorkTrend");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

// Суммарное пересечение интервалов работ (информационно: задвоенное время)
const calcOverlapMinutes = (works) => {
  const intervals = works
    .map((work) => [
      new Date(work.startedAt).getTime(),
      new Date(work.finishedAt).getTime(),
    ])
    .sort((a, b) => a[0] - b[0]);

  let overlapMs = 0;
  let maxEnd = 0;
  for (const [start, end] of intervals) {
    overlapMs += Math.max(0, Math.min(end, maxEnd) - start);
    maxEnd = Math.max(maxEnd, end);
  }
  return toMinutes(overlapMs);
};


/**
 * Персональный отчёт сотрудника за период [from..to] (даты "YYYY-MM-DD",
 * границы суток в поясе организации). Переработки считаются идентично
 * сводному финансовому отчёту — см. calcWorkOvertime/resolveWorkSchedule.
 * preferences и user передаются снаружи (plain-объекты, .lean()).
 */
const buildPersonalReport = async ({
  userId,
  from,
  to,
  preferences,
  user,
  includeDetails = true,
}) => {
  const tz = resolveTimezone(preferences);
  const overtimeSettings = resolveOvertimeSettings(preferences);

  const fromDay = dayjs.tz(from, tz).startOf("day");
  const toDay = dayjs.tz(to, tz).endOf("day");
  const periodDays = Math.round((toDay.valueOf() + 1 - fromDay.valueOf()) / MS_PER_DAY);
  const isFullMonth =
    fromDay.date() === 1 && toDay.isSame(fromDay.endOf("month"), "day");

  const [works, ticketsFinished] = await Promise.all([
    Work.find({
      "finishedBy._id": userId,
      finishedAt: { $gte: fromDay.toDate(), $lte: toDay.toDate() },
    })
      .populate("company", "alias fullTitle workSchedule servicePlans")
      // routineTask (с existence-check вложенным populate) — для классификации
      // работ на выезд / удалённо / регламент общим правилом ядра
      .populate({
        path: "tickets",
        select: "num title categoryId routineTask",
        populate: { path: "routineTask", select: "_id" },
      })
      .sort({ startedAt: 1 })
      .lean(),
    Ticket.countDocuments({
      finishedBy: userId,
      finishedAt: { $gte: fromDay.toDate(), $lte: toDay.toDate() },
    }),
  ]);

  // Календарь периода + отсутствия сотрудника: один запрос на весь отчёт
  const fromKey = fromDay.format("YYYY-MM-DD");
  const toKey = toDay.format("YYYY-MM-DD");
  const scheduleContext = await buildScheduleContext({
    fromKey,
    toKey,
    userIds: [userId],
    preferences,
  });
  const planner = makePlanner(user, scheduleContext, overtimeSettings);

  // Тарифы компаний и флаги alwaysWithinPlan категорий — общим контекстом
  const { plansByCompany, categoriesById } = await buildOvertimeContext(works);

  // Каркас byDay — по записи на каждый день периода (непрерывная ось)
  const byDayMap = new Map();
  let cursor = fromDay.startOf("day");
  while (cursor.valueOf() <= toDay.valueOf()) {
    const dateKey = cursor.format("YYYY-MM-DD");
    // План дня едет вместе с фактом: месячная сетка отчёта красит праздники и
    // отсутствия сама, не пересчитывая календарь на клиенте
    const plan = planner.dayPlan(dateKey);
    byDayMap.set(dateKey, {
      date: dateKey,
      minutes: 0,
      overtimeMinutes: 0,
      worksCount: 0,
      onSiteCount: 0,
      kind: plan.kind,
      normMinutes: plan.minutes,
      holidayTitle: plan.holidayTitle,
      absenceType: plan.absence?.type ?? null,
    });
    cursor = cursor.add(1, "day");
  }

  const totals = {
    worksCount: works.length,
    totalMinutes: 0,
    // Классы работ — правилом ядра: регламент отдельно от выездов и удалёнки
    // (раньше регламентные растворялись в них по visitRequired)
    onSite: { count: 0, minutes: 0 },
    remote: { count: 0, minutes: 0 },
    routineTask: { count: 0, minutes: 0 },
    ticketsFinished,
    byStatus: {},
    overtime: {
      actualMinutes: 0,
      roundedMinutes: 0,
      weekdayMinutes: 0,
      weekendMinutes: 0,
      holidayMinutes: 0,
      daysWithOvertime: 0,
      // "user" — переработка мерялась по личному графику сотрудника в его
      // поясе; остальные три — прежний путь по окну обслуживания клиента
      byScheduleSource: { user: 0, plan: 0, company: 0, fallback: 0 },
    },
  };
  const byCompanyMap = new Map();
  const byCategoryMap = new Map();
  const overtimeDates = new Set();
  const validWorks = [];
  const workDetails = [];
  let excludedWorks = 0;
  let fallbackScheduleWorks = 0;

  for (const work of works) {
    const issues = [];
    if (!work.startedAt || !work.finishedAt) {
      issues.push("noTimestamps");
    } else if (new Date(work.finishedAt) < new Date(work.startedAt)) {
      issues.push("invalidRange");
    }

    const isValid = issues.length === 0;
    const durationMs = isValid ? workDurationMs(work) : 0;
    if (isValid && durationMs > MS_PER_DAY) {
      issues.push("over24h");
    }
    const durationMinutes = toMinutes(durationMs);

    const excludedFromOvertime = isExcludedFromOvertime(work, categoriesById);
    const resolved = overtimeForWork(work, {
      planner,
      plansByCompany,
      overtimeSettings,
      orgTz: tz,
    });
    const overtime =
      isValid && !excludedFromOvertime ? resolved.overtime : emptyOvertime();

    if (!isValid) {
      excludedWorks += 1;
    } else {
      validWorks.push(work);

      totals.totalMinutes += durationMinutes;
      const classKey = classifyWork(work);
      totals[classKey].count += 1;
      totals[classKey].minutes += durationMinutes;

      const categoryId = work.tickets?.[0]?.categoryId?.toString();
      const categoryKey = categoryId || "none";
      if (!byCategoryMap.has(categoryKey)) {
        byCategoryMap.set(categoryKey, {
          _id: categoryId ?? null,
          title: categoriesById.get(categoryId)?.title || "Без категории",
          minutes: 0,
          worksCount: 0,
        });
      }
      const categoryEntry = byCategoryMap.get(categoryKey);
      categoryEntry.minutes += durationMinutes;
      categoryEntry.worksCount += 1;

      const statusKey = work.finances?.status || "none";
      if (!totals.byStatus[statusKey]) {
        totals.byStatus[statusKey] = { count: 0, minutes: 0 };
      }
      totals.byStatus[statusKey].count += 1;
      totals.byStatus[statusKey].minutes += durationMinutes;

      totals.overtime.byScheduleSource[resolved.scheduleSource] += 1;
      if (resolved.scheduleSource === "fallback") {
        fallbackScheduleWorks += 1;
      }

      // Распределение времени по дням периода (сегменты до begin периода
      // остаются в totals, но в byDay не попадают — ось ограничена периодом)
      for (const segment of splitIntoDaySegments(work.startedAt, work.finishedAt, tz)) {
        const dayEntry = byDayMap.get(segment.date);
        if (!dayEntry) {
          continue;
        }
        dayEntry.minutes += toMinutes(segment.ms);
        dayEntry.worksCount += 1;
        if (work.visitRequired) {
          dayEntry.onSiteCount += 1;
        }
      }

      totals.overtime.actualMinutes += toMinutes(overtime.actualMs);
      totals.overtime.roundedMinutes += toMinutes(overtime.roundedMs);
      for (const day of overtime.days) {
        if (day.bucket === "holiday") {
          totals.overtime.holidayMinutes += day.roundedMinutes;
        } else if (day.bucket === "weekend") {
          totals.overtime.weekendMinutes += day.roundedMinutes;
        } else {
          totals.overtime.weekdayMinutes += day.roundedMinutes;
        }
        if (day.roundedMinutes > 0) {
          overtimeDates.add(day.date);
        }
        const dayEntry = byDayMap.get(day.date);
        if (dayEntry) {
          dayEntry.overtimeMinutes += day.roundedMinutes;
        }
      }

      const companyKey = work.company?._id?.toString() || "none";
      if (!byCompanyMap.has(companyKey)) {
        byCompanyMap.set(companyKey, {
          _id: work.company?._id ?? null,
          alias: work.company?.alias || "Без компании",
          minutes: 0,
          worksCount: 0,
          onSiteCount: 0,
          overtimeMinutes: 0,
        });
      }
      const companyEntry = byCompanyMap.get(companyKey);
      companyEntry.minutes += durationMinutes;
      companyEntry.worksCount += 1;
      if (work.visitRequired) {
        companyEntry.onSiteCount += 1;
      }
      companyEntry.overtimeMinutes += toMinutes(overtime.roundedMs);
    }

    if (includeDetails) {
      workDetails.push({
        _id: work._id,
        description: work.description || "",
        startedAt: work.startedAt,
        finishedAt: work.finishedAt,
        durationMinutes,
        visitRequired: Boolean(work.visitRequired),
        workClass: classifyWork(work),
        withinPlan: Boolean(work.withinPlan),
        alwaysWithinPlan: excludedFromOvertime,
        financesStatus: work.finances?.status || null,
        company: work.company
          ? { _id: work.company._id, alias: work.company.alias }
          : null,
        tickets: (work.tickets || []).map((ticket) => ({
          _id: ticket._id,
          num: ticket.num,
          title: ticket.title,
        })),
        scheduleSource: resolved.scheduleSource,
        planTitle: resolved.planTitle,
        tariffingPeriodMinutes: resolved.tariffingPeriodMinutes,
        overtime: {
          actualMinutes: toMinutes(overtime.actualMs),
          roundedMinutes: toMinutes(overtime.roundedMs),
          days: overtime.days,
        },
        issues,
      });
    }
  }

  totals.overtime.daysWithOvertime = overtimeDates.size;

  // Норма периода — по личному графику сотрудника с производственным
  // календарём и минус подтверждённые отсутствия (services/workCalendar).
  // Раньше это был «резервный график × календарные дни» без праздников.
  const period = planner.periodPlan(fromKey, toKey);
  totals.normMinutes = period.normMinutes;
  totals.normMinutesBeforeAbsences = period.normMinutesBeforeAbsences;
  totals.workingDaysCount = period.workingDays;
  totals.absenceDays = period.absenceDays;
  totals.utilizationPercent =
    period.normMinutes > 0
      ? Math.round((totals.totalMinutes / period.normMinutes) * 100)
      : null;

  const withShare = (entry) => ({
    ...entry,
    sharePercent:
      totals.totalMinutes > 0
        ? Math.round((entry.minutes / totals.totalMinutes) * 1000) / 10
        : 0,
  });

  const byCompany = [...byCompanyMap.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .map(withShare);

  const byCategory = [...byCategoryMap.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .map(withShare);

  const payroll = buildPayroll(user, totals.overtime, overtimeSettings, isFullMonth);

  const report = {
    period: {
      from: fromKey,
      to: toKey,
      days: periodDays,
      isFullMonth,
      // Пояс, в котором резались сутки: личный сотрудника, если задан
      timezone: planner.tz,
      organizationTimezone: tz,
    },
    schedule: {
      source: planner.scheduleSource,
      hasPersonalSchedule: planner.hasPersonalSchedule,
      followsProductionCalendar: planner.followsCalendar,
      week: planner.schedule,
    },
    settings: {
      defaultSchedule: overtimeSettings.defaultSchedule,
      defaultTariffingPeriodMinutes: overtimeSettings.defaultTariffingPeriodMinutes,
      weekdayCoefficient: overtimeSettings.weekdayCoefficient,
      weekendCoefficient: overtimeSettings.weekendCoefficient,
      holidayCoefficient: overtimeSettings.holidayCoefficient,
    },
    totals,
    payroll,
    byDay: [...byDayMap.values()],
    byCompany,
    byCategory,
    warnings: {
      excludedWorks,
      overlapMinutes: calcOverlapMinutes(validWorks),
      fallbackScheduleWorks,
    },
  };

  if (includeDetails) {
    report.works = workDetails;
    // Помесячная динамика — общий сервис (его же зовёт режим «Динамика»
    // отчёта «Сотрудники»); здесь частный случай на одного человека
    const trend = await buildMonthlyWorkTrend({
      users: [user],
      anchorDay: toDay,
      tz,
      overtimeSettings,
      preferences,
    });
    report.byMonth = trend.months;

    // Предыдущий период той же длины — для дельт на KPI-картах
    const prevFrom = fromDay.subtract(periodDays, "day").format("YYYY-MM-DD");
    const prevTo = fromDay.subtract(1, "day").format("YYYY-MM-DD");
    const prev = await buildPersonalReport({
      userId,
      from: prevFrom,
      to: prevTo,
      preferences,
      user,
      includeDetails: false,
    });
    report.prevPeriod = {
      period: prev.period,
      totals: prev.totals,
      overtimePay: prev.payroll?.overtimePay ?? null,
    };
  }

  return report;
};

module.exports = { buildPersonalReport };
