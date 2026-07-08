const Work = require("@/models/work");
const { Ticket } = require("@/models/ticket");
const ServicePlan = require("@/models/finances/servicePlan");
const TicketCategory = require("@/models/ticketCategory");

const { DEFAULT_OVERTIME_SETTINGS } = require("@/utils/overtimeDefaults");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

// Monday-first, как daysOfWeek в frontend/src/util/finances.js
const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const dayNameOf = (day) => DAYS_OF_WEEK[(day.day() + 6) % 7];

const toMinutes = (ms) => Math.round(ms / MS_PER_MINUTE);

const roundUpMs = (ms, stepMinutes) =>
  Math.ceil(ms / (stepMinutes * MS_PER_MINUTE)) * (stepMinutes * MS_PER_MINUTE);

// "HH:mm" → минуты от полуночи; null для пустых/битых значений
const parseTimeOfDay = (value) => {
  if (typeof value !== "string" || !value.includes(":")) {
    return null;
  }
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
};

const emptyOvertime = () => ({ actualMs: 0, roundedMs: 0, days: [] });

/**
 * Порт calcSingleWorkOvertime из frontend/src/util/finances.js — семантика 1:1
 * со сводным финансовым отчётом, но границы суток в поясе организации:
 * рабочий день графика — переработка = время до start + после end; нерабочий
 * день — весь кусок работы; каждый кусок округляется вверх до периода
 * тарификации. is24hours (или пустые start/end — Schedule очищает их для
 * 24-часовых дней) → переработки в этот день нет, как и на клиенте.
 */
const calcWorkOvertime = (work, schedule, tariffingPeriodMinutes, tz) => {
  const result = emptyOvertime();

  const startedAt = dayjs(work.startedAt).tz(tz);
  const finishedAt = dayjs(work.finishedAt).tz(tz);

  if (startedAt.valueOf() === finishedAt.valueOf() || work.withinPlan) {
    return result;
  }

  let currentDay = startedAt.startOf("day");
  const lastDay = finishedAt.startOf("day");

  while (currentDay.valueOf() <= lastDay.valueOf()) {
    const segStart = Math.max(currentDay.valueOf(), startedAt.valueOf());
    const segEnd = Math.min(currentDay.endOf("day").valueOf(), finishedAt.valueOf());

    const daySchedule = schedule?.[dayNameOf(currentDay)];
    const isWorkingDay = Boolean(daySchedule && daySchedule.isWorking);

    let dayActualMs = 0;
    let dayRoundedMs = 0;

    if (isWorkingDay) {
      const startMinutes = parseTimeOfDay(daySchedule.start);
      const endMinutes = parseTimeOfDay(daySchedule.end);
      if (!daySchedule.is24hours && startMinutes !== null && endMinutes !== null) {
        const workStart = currentDay.valueOf() + startMinutes * MS_PER_MINUTE;
        const workEnd = currentDay.valueOf() + endMinutes * MS_PER_MINUTE;

        // до начала рабочего дня
        if (segStart < workStart) {
          const chunk = Math.min(workStart - segStart, segEnd - segStart);
          dayActualMs += chunk;
          dayRoundedMs += roundUpMs(chunk, tariffingPeriodMinutes);
        }
        // после окончания рабочего дня
        if (segEnd > workEnd) {
          const chunk = segEnd - Math.max(workEnd, segStart);
          dayActualMs += chunk;
          dayRoundedMs += roundUpMs(chunk, tariffingPeriodMinutes);
        }
      }
    } else {
      const chunk = segEnd - segStart;
      dayActualMs += chunk;
      dayRoundedMs += roundUpMs(chunk, tariffingPeriodMinutes);
    }

    if (dayActualMs > 0) {
      result.days.push({
        date: currentDay.format("YYYY-MM-DD"),
        bucket: isWorkingDay ? "weekday" : "weekend",
        actualMinutes: toMinutes(dayActualMs),
        roundedMinutes: toMinutes(dayRoundedMs),
      });
      result.actualMs += dayActualMs;
      result.roundedMs += dayRoundedMs;
    }

    currentDay = currentDay.add(1, "day");
  }

  return result;
};

// Интервал работы → куски по локальным суткам (для byDay и календаря)
const splitIntoDaySegments = (startedAt, finishedAt, tz) => {
  const segments = [];
  const start = dayjs(startedAt).tz(tz);
  const finish = dayjs(finishedAt).tz(tz);

  let currentDay = start.startOf("day");
  const lastDay = finish.startOf("day");

  while (currentDay.valueOf() <= lastDay.valueOf()) {
    const segStart = Math.max(currentDay.valueOf(), start.valueOf());
    const segEnd = Math.min(currentDay.endOf("day").valueOf(), finish.valueOf());
    if (segEnd > segStart) {
      segments.push({ date: currentDay.format("YYYY-MM-DD"), ms: segEnd - segStart });
    }
    currentDay = currentDay.add(1, "day");
  }

  return segments;
};

/**
 * График и период тарификации для работы — как в сводном отчёте (PreviewTable):
 * первый тариф компании, чьи ticketCategories содержат категорию заявки работы;
 * график тарифа или компании по флагу companyWorkSchedule. Работам вне тарифов
 * (и при отсутствующем графике компании) — резервные значения из настроек.
 */
const resolveWorkSchedule = (work, plansByCompany, overtimeSettings) => {
  const companyId = work.company?._id?.toString();
  const plans = (companyId && plansByCompany.get(companyId)) || [];
  const ticketCategoryIds = (work.tickets || [])
    .map((ticket) => ticket.categoryId?.toString())
    .filter(Boolean);

  const plan = plans.find((candidate) =>
    (candidate.ticketCategories || []).some((category) =>
      ticketCategoryIds.includes(category._id?.toString()),
    ),
  );

  const tariffingPeriodMinutes = plan
    ? (plan.tariffingPeriod ??
      plan.tariffing?.period ??
      overtimeSettings.defaultTariffingPeriodMinutes)
    : overtimeSettings.defaultTariffingPeriodMinutes;

  if (plan) {
    const schedule = plan.companyWorkSchedule
      ? work.company?.workSchedule
      : plan.customProvisionSchedule;
    if (schedule) {
      return {
        schedule,
        tariffingPeriodMinutes,
        scheduleSource: plan.companyWorkSchedule ? "company" : "plan",
        planTitle: plan.title ?? null,
      };
    }
  }

  return {
    schedule: overtimeSettings.defaultSchedule,
    tariffingPeriodMinutes,
    scheduleSource: "fallback",
    planTitle: plan?.title ?? null,
  };
};

// Норма часов периода по резервному графику (информационно, для utilization)
const calcNormMinutes = (fromDay, toDay, schedule) => {
  let normMinutes = 0;
  let workingDaysCount = 0;

  let day = fromDay.startOf("day");
  while (day.valueOf() <= toDay.valueOf()) {
    const daySchedule = schedule?.[dayNameOf(day)];
    if (daySchedule?.isWorking) {
      workingDaysCount += 1;
      if (daySchedule.is24hours) {
        normMinutes += 24 * 60;
      } else {
        const start = parseTimeOfDay(daySchedule.start);
        const end = parseTimeOfDay(daySchedule.end);
        if (start !== null && end !== null && end > start) {
          normMinutes += end - start;
        }
      }
    }
    day = day.add(1, "day");
  }

  return { normMinutes, workingDaysCount };
};

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

const buildPayroll = (user, overtimeTotals, overtimeSettings, isFullMonth) => {
  const salary = user?.finances?.salary ?? null;
  const rate = user?.finances?.overtimeHourlyRate ?? null;

  const payFor = (minutes, coefficient) =>
    rate == null ? null : Math.round((minutes / 60) * rate * coefficient);

  const weekdayPay = payFor(
    overtimeTotals.weekdayMinutes,
    overtimeSettings.weekdayCoefficient,
  );
  const weekendPay = payFor(
    overtimeTotals.weekendMinutes,
    overtimeSettings.weekendCoefficient,
  );
  const overtimePay = rate == null ? null : weekdayPay + weekendPay;

  return {
    salary,
    overtimeHourlyRate: rate,
    weekday: {
      minutes: overtimeTotals.weekdayMinutes,
      coefficient: overtimeSettings.weekdayCoefficient,
      pay: weekdayPay,
    },
    weekend: {
      minutes: overtimeTotals.weekendMinutes,
      coefficient: overtimeSettings.weekendCoefficient,
      pay: weekendPay,
    },
    overtimePay,
    // Итог с окладом имеет смысл только для полного календарного месяца —
    // оклад пропорционально не делим
    estimatedTotal:
      isFullMonth && salary != null && overtimePay != null
        ? salary + overtimePay
        : null,
    isFullMonth,
    missing: { salary: salary == null, overtimeHourlyRate: rate == null },
  };
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
  const tz = preferences?.timezone || "Europe/Moscow";

  const prefOvertime = preferences?.overtime || {};
  const overtimeSettings = { ...DEFAULT_OVERTIME_SETTINGS };
  for (const [key, value] of Object.entries(prefOvertime)) {
    if (value !== undefined && value !== null) {
      overtimeSettings[key] = value;
    }
  }
  // Битый/пустой резервный график непредсказуемо пометил бы все дни нерабочими
  if (!overtimeSettings.defaultSchedule?.Monday) {
    overtimeSettings.defaultSchedule = DEFAULT_OVERTIME_SETTINGS.defaultSchedule;
  }

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
      .populate({ path: "tickets", select: "num title categoryId" })
      .sort({ startedAt: 1 })
      .lean(),
    Ticket.countDocuments({
      finishedBy: userId,
      finishedAt: { $gte: fromDay.toDate(), $lte: toDay.toDate() },
    }),
  ]);

  // Тарифы задействованных компаний — одним запросом
  const planIds = new Set();
  for (const work of works) {
    for (const planRef of work.company?.servicePlans || []) {
      if (planRef._id) {
        planIds.add(planRef._id.toString());
      }
    }
  }
  const plans = planIds.size
    ? await ServicePlan.find({ _id: { $in: [...planIds] } })
        .select(
          "title ticketCategories companyWorkSchedule customProvisionSchedule tariffingPeriod tariffing",
        )
        .lean()
    : [];
  const plansById = new Map(plans.map((plan) => [plan._id.toString(), plan]));
  const plansByCompany = new Map();
  for (const work of works) {
    const companyId = work.company?._id?.toString();
    if (!companyId || plansByCompany.has(companyId)) {
      continue;
    }
    plansByCompany.set(
      companyId,
      (work.company.servicePlans || [])
        .map((planRef) => (planRef._id ? plansById.get(planRef._id.toString()) : null))
        .filter(Boolean),
    );
  }

  // Флаги alwaysWithinPlan категорий заявок — одним запросом
  const categoryIds = new Set();
  for (const work of works) {
    for (const ticket of work.tickets || []) {
      if (ticket.categoryId) {
        categoryIds.add(ticket.categoryId.toString());
      }
    }
  }
  const categories = categoryIds.size
    ? await TicketCategory.find({ _id: { $in: [...categoryIds] } })
        .select("alwaysWithinPlan")
        .lean()
    : [];
  const categoriesById = new Map(
    categories.map((category) => [category._id.toString(), category]),
  );

  // Каркас byDay — по записи на каждый день периода (непрерывная ось)
  const byDayMap = new Map();
  let cursor = fromDay.startOf("day");
  while (cursor.valueOf() <= toDay.valueOf()) {
    byDayMap.set(cursor.format("YYYY-MM-DD"), {
      date: cursor.format("YYYY-MM-DD"),
      minutes: 0,
      overtimeMinutes: 0,
      worksCount: 0,
      onSiteCount: 0,
    });
    cursor = cursor.add(1, "day");
  }

  const totals = {
    worksCount: works.length,
    totalMinutes: 0,
    onSite: { count: 0, minutes: 0 },
    remote: { count: 0, minutes: 0 },
    ticketsFinished,
    byStatus: {},
    overtime: {
      actualMinutes: 0,
      roundedMinutes: 0,
      weekdayMinutes: 0,
      weekendMinutes: 0,
      daysWithOvertime: 0,
      byScheduleSource: { plan: 0, company: 0, fallback: 0 },
    },
  };
  const byCompanyMap = new Map();
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
    const durationMs = isValid
      ? new Date(work.finishedAt).getTime() - new Date(work.startedAt).getTime()
      : 0;
    if (isValid && durationMs > MS_PER_DAY) {
      issues.push("over24h");
    }
    const durationMinutes = toMinutes(durationMs);

    const resolved = resolveWorkSchedule(work, plansByCompany, overtimeSettings);
    const firstCategory = categoriesById.get(
      work.tickets?.[0]?.categoryId?.toString(),
    );
    const excludedFromOvertime = Boolean(firstCategory?.alwaysWithinPlan);
    const overtime =
      isValid && !excludedFromOvertime
        ? calcWorkOvertime(work, resolved.schedule, resolved.tariffingPeriodMinutes, tz)
        : emptyOvertime();

    if (!isValid) {
      excludedWorks += 1;
    } else {
      validWorks.push(work);

      totals.totalMinutes += durationMinutes;
      const visitBucket = work.visitRequired ? totals.onSite : totals.remote;
      visitBucket.count += 1;
      visitBucket.minutes += durationMinutes;

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
        if (day.bucket === "weekend") {
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

  const { normMinutes, workingDaysCount } = calcNormMinutes(
    fromDay,
    toDay,
    overtimeSettings.defaultSchedule,
  );
  totals.normMinutes = normMinutes;
  totals.workingDaysCount = workingDaysCount;
  totals.utilizationPercent =
    normMinutes > 0 ? Math.round((totals.totalMinutes / normMinutes) * 100) : null;

  const byCompany = [...byCompanyMap.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .map((entry) => ({
      ...entry,
      sharePercent:
        totals.totalMinutes > 0
          ? Math.round((entry.minutes / totals.totalMinutes) * 1000) / 10
          : 0,
    }));

  const payroll = buildPayroll(user, totals.overtime, overtimeSettings, isFullMonth);

  const report = {
    period: {
      from: fromDay.format("YYYY-MM-DD"),
      to: toDay.format("YYYY-MM-DD"),
      days: periodDays,
      isFullMonth,
      timezone: tz,
    },
    settings: {
      defaultSchedule: overtimeSettings.defaultSchedule,
      defaultTariffingPeriodMinutes: overtimeSettings.defaultTariffingPeriodMinutes,
      weekdayCoefficient: overtimeSettings.weekdayCoefficient,
      weekendCoefficient: overtimeSettings.weekendCoefficient,
    },
    totals,
    payroll,
    byDay: [...byDayMap.values()],
    byCompany,
    warnings: {
      excludedWorks,
      overlapMinutes: calcOverlapMinutes(validWorks),
      fallbackScheduleWorks,
    },
  };

  if (includeDetails) {
    report.works = workDetails;

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

module.exports = {
  buildPersonalReport,
  // экспорт для точечных проверок/переиспользования
  calcWorkOvertime,
  resolveWorkSchedule,
  splitIntoDaySegments,
};
