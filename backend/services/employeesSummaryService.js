const Work = require("@/models/work");
const User = require("@/models/user");
const { Ticket } = require("@/models/ticket");

const { filterApprovedWorks } = require("@/services/approvedWorks");

const { resolveTimezone } = require("@/utils/datetime");
const { TRACKED_FILTER } = require("@/services/financeTracking");
const {
  classifyWork,
  toMinutes,
  workDurationMs,
} = require("@/services/workSummary");
const {
  buildOvertimeContext,
  buildPayroll,
  isExcludedFromOvertime,
  overtimeForWork,
  resolveOvertimeSettings,
  stripPayrollMoney,
} = require("@/services/workOvertime");
const {
  buildScheduleContext,
  makePlanner,
} = require("@/services/workCalendar");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Сводка по сотрудникам за период: часы, классы работ, переработки и доплата
 * по каждому. Заменяет отчёт «По сотрудникам», который считал переработки по
 * захардкоженному графику 09:00–18:00 и ставке 1000 ₽/ч мимо тарифов и
 * настроек — здесь всё считает общий workOvertime, как в персональном отчёте
 * (инвариант: строка сотрудника = его персональный отчёт за тот же период).
 *
 * approvedOnly сужает выборку до работ из согласованных отчётов по услугам
 * (режим финансовой сверки); по умолчанию учитываются все работы периода.
 *
 * canSeeMoney (право `user.manageFinances`) решает контроллер: без него в
 * ответе нет ни ставок, ни доплат — только часы, переработки и флаг «нет
 * ставки», по которому видно, что время не попало в расчёт.
 */

const emptyTotals = () => ({
  employeesCount: 0,
  employeesWithWorks: 0,
  worksCount: 0,
  ticketsFinished: 0,
  totalMinutes: 0,
  // Норма периода по производственному календарю и личным графикам, минус
  // подтверждённые отсутствия. Считается всем, у кого есть график (личный или
  // резервный), поэтому сходится с суммой по строкам.
  normMinutes: 0,
  absenceDays: 0,
  onSite: { count: 0, minutes: 0 },
  remote: { count: 0, minutes: 0 },
  routineTask: { count: 0, minutes: 0 },
  overtime: {
    roundedMinutes: 0,
    weekdayMinutes: 0,
    weekendMinutes: 0,
    holidayMinutes: 0,
  },
  overtimePaySum: 0,
  missingRateCount: 0,
  // У скольких сотрудников не задан личный график: пока он пустой, переработки
  // считаются по окну обслуживания клиента, как до появления «Графиков работы»
  noScheduleCount: 0,
});

// Работы периода + (опционально) фильтр по согласованным отчётам
const loadPeriodWorks = async ({ fromDate, toDate, approvedOnly }) => {
  const works = await Work.find({
    finishedAt: { $gte: fromDate, $lte: toDate },
  })
    .populate("company", "alias workSchedule servicePlans")
    .populate({
      path: "tickets",
      select: "categoryId routineTask",
      populate: { path: "routineTask", select: "_id" },
    })
    .lean();

  if (!approvedOnly) {
    return works;
  }

  return filterApprovedWorks(works, { fromDate, toDate });
};

/** Доли в процентах — считает бэкенд, чтобы разрезы везде читались одинаково. */
const withShares = (buckets, totalMinutes) =>
  [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      sharePercent: totalMinutes
        ? Math.round((bucket.minutes / totalMinutes) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

// Срез сотрудника: часы, классы, переработки (payroll добавляется отдельно).
// includeBreakdown добавляет разрезы по компаниям и категориям заявок — они
// нужны режиму «Статистика», но не нужны пересчёту прошлого периода.
const summarizeEmployeeWorks = ({
  works,
  categoriesById,
  overtimeSettings,
  planner,
  orgTz,
  includeBreakdown = true,
}) => {
  const row = {
    worksCount: 0,
    totalMinutes: 0,
    onSite: { count: 0, minutes: 0 },
    remote: { count: 0, minutes: 0 },
    routineTask: { count: 0, minutes: 0 },
    overtime: {
      actualMinutes: 0,
      roundedMinutes: 0,
      weekdayMinutes: 0,
      weekendMinutes: 0,
      holidayMinutes: 0,
      worksCount: 0,
    },
  };

  const byCompany = new Map();
  const byCategory = new Map();

  for (const work of works) {
    row.worksCount += 1;
    const minutes = toMinutes(workDurationMs(work));
    row.totalMinutes += minutes;

    const classKey = classifyWork(work);
    row[classKey].count += 1;
    row[classKey].minutes += minutes;

    if (includeBreakdown) {
      const companyId = work.company?._id?.toString() || null;
      const companyKey = companyId || "none";
      if (!byCompany.has(companyKey)) {
        byCompany.set(companyKey, {
          _id: companyId,
          alias: work.company?.alias || "Без компании",
          minutes: 0,
          worksCount: 0,
          onSiteCount: 0,
        });
      }
      const companyBucket = byCompany.get(companyKey);
      companyBucket.minutes += minutes;
      companyBucket.worksCount += 1;
      if (classKey === "onSite") {
        companyBucket.onSiteCount += 1;
      }

      // Категория — по первой заявке работы, ровно как в персональном отчёте:
      // иначе строка сотрудника перестанет сходиться с его отчётом
      const categoryId = work.tickets?.[0]?.categoryId?.toString();
      const categoryKey = categoryId || "none";
      if (!byCategory.has(categoryKey)) {
        byCategory.set(categoryKey, {
          _id: categoryId ?? null,
          title: categoriesById.get(categoryId)?.title || "Без категории",
          minutes: 0,
          worksCount: 0,
        });
      }
      const categoryBucket = byCategory.get(categoryKey);
      categoryBucket.minutes += minutes;
      categoryBucket.worksCount += 1;
    }

    if (isExcludedFromOvertime(work, categoriesById) || !work.startedAt || !work.finishedAt) {
      continue;
    }

    const { overtime } = overtimeForWork(work, {
      planner,
      overtimeSettings,
      orgTz,
    });
    if (overtime.roundedMs > 0) {
      row.overtime.worksCount += 1;
    }
    row.overtime.actualMinutes += toMinutes(overtime.actualMs);
    row.overtime.roundedMinutes += toMinutes(overtime.roundedMs);
    for (const day of overtime.days) {
      if (day.bucket === "holiday") {
        row.overtime.holidayMinutes += day.roundedMinutes;
      } else if (day.bucket === "weekend") {
        row.overtime.weekendMinutes += day.roundedMinutes;
      } else {
        row.overtime.weekdayMinutes += day.roundedMinutes;
      }
    }
  }

  if (includeBreakdown) {
    row.byCompany = withShares(byCompany, row.totalMinutes);
    row.byCategory = withShares(byCategory, row.totalMinutes);
  }

  return row;
};

const buildEmployeesSummary = async ({
  from,
  to,
  approvedOnly = false,
  preferences,
  canSeeMoney = false,
  includePrev = true,
  includeBreakdown = true,
}) => {
  const tz = resolveTimezone(preferences);
  const overtimeSettings = resolveOvertimeSettings(preferences);

  const fromDay = dayjs.tz(from, tz).startOf("day");
  const toDay = dayjs.tz(to, tz).endOf("day");
  const periodDays = Math.round(
    (toDay.valueOf() + 1 - fromDay.valueOf()) / (24 * 60 * 60 * 1000),
  );
  const isFullMonth =
    fromDay.date() === 1 && toDay.isSame(fromDay.endOf("month"), "day");

  const [works, employees] = await Promise.all([
    loadPeriodWorks({
      fromDate: fromDay.toDate(),
      toDate: toDay.toDate(),
      approvedOnly,
    }),
    // Тот же набор, что отдаёт селектор сотрудников отчёта. Без тех, у кого
    // финансовый учёт не ведётся (services/financeTracking.js)
    User.find({
      banned: { $ne: true },
      isEndUser: false,
      isServiceAccount: false,
      ...TRACKED_FILTER,
    })
      .select(
        "firstName lastName position finances timezone workSchedule workSchedules followProductionCalendar",
      )
      .sort({ lastName: 1, firstName: 1 })
      .lean(),
  ]);

  const { categoriesById } = await buildOvertimeContext(works);

  const worksByExecutor = new Map();
  for (const work of works) {
    const executorId = work.finishedBy?._id?.toString();
    if (!executorId) {
      continue;
    }
    const bucket = worksByExecutor.get(executorId);
    if (bucket) {
      bucket.push(work);
    } else {
      worksByExecutor.set(executorId, [work]);
    }
  }

  // Строки = активные сотрудники ∪ исполнители работ периода: уволенный с
  // работами в периоде не должен пропадать из финансовой сверки
  const employeeById = new Map(
    employees.map((employee) => [employee._id.toString(), employee]),
  );
  const formerIds = [...worksByExecutor.keys()].filter(
    (id) => !employeeById.has(id),
  );
  if (formerIds.length) {
    // …и тем же отбором: исполнитель без учёта не должен вернуться в отчёт
    // строкой «у него были работы в периоде»
    const formerEmployees = await User.find({
      _id: { $in: formerIds },
      ...TRACKED_FILTER,
    })
      .select(
        "firstName lastName position finances banned timezone workSchedule workSchedules followProductionCalendar",
      )
      .lean();
    for (const employee of formerEmployees) {
      employeeById.set(employee._id.toString(), employee);
    }
  }

  // Закрытые заявки — по всем исполнителям одним запросом; разрез по компаниям
  // берётся из того же запроса (нужен разрезу «по компаниям» у сотрудника)
  const ticketsByExecutor = new Map();
  const ticketsByExecutorCompany = new Map();
  const ticketRows = await Ticket.aggregate([
    {
      $match: {
        finishedBy: { $ne: null },
        finishedAt: { $gte: fromDay.toDate(), $lte: toDay.toDate() },
      },
    },
    {
      $group: {
        _id: { executor: "$finishedBy", company: "$company._id" },
        count: { $sum: 1 },
      },
    },
  ]);
  for (const row of ticketRows) {
    const executorId = row._id.executor.toString();
    ticketsByExecutor.set(
      executorId,
      (ticketsByExecutor.get(executorId) || 0) + row.count,
    );
    if (row._id.company) {
      ticketsByExecutorCompany.set(
        `${executorId}:${row._id.company.toString()}`,
        row.count,
      );
    }
  }

  // Контекст графиков — один раз на всю выборку: календарь задетых лет плюс
  // подтверждённые отсутствия всех сотрудников периода
  const fromKey = fromDay.format("YYYY-MM-DD");
  const toKey = toDay.format("YYYY-MM-DD");
  const scheduleContext = await buildScheduleContext({
    fromKey,
    toKey,
    userIds: [...employeeById.keys()],
    preferences,
  });

  const totals = emptyTotals();
  const rows = [];

  for (const [employeeId, employee] of employeeById) {
    const employeeWorks = worksByExecutor.get(employeeId) || [];
    const planner = makePlanner(employee, scheduleContext, overtimeSettings);
    const period = planner.periodPlan(fromKey, toKey);
    const summary = summarizeEmployeeWorks({
      works: employeeWorks,
      categoriesById,
      overtimeSettings,
      planner,
      orgTz: tz,
      includeBreakdown,
    });

    if (includeBreakdown) {
      for (const bucket of summary.byCompany) {
        bucket.ticketsFinished = bucket._id
          ? ticketsByExecutorCompany.get(`${employeeId}:${bucket._id}`) || 0
          : 0;
      }
    }
    const payroll = buildPayroll(
      employee,
      summary.overtime,
      overtimeSettings,
      isFullMonth,
    );
    const ticketsFinished = ticketsByExecutor.get(employeeId) || 0;

    // Строке сводки из payroll нужны ставка, разбивка и доплата; деньги из неё
    // вырезаются одним общим правилом
    const rowPayroll = {
      overtimeHourlyRate: payroll.overtimeHourlyRate,
      weekday: payroll.weekday,
      weekend: payroll.weekend,
      holiday: payroll.holiday,
      overtimePay: payroll.overtimePay,
      missingRate: payroll.missing.overtimeHourlyRate,
    };

    rows.push({
      employee: {
        _id: employee._id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        position: employee.position ?? null,
        isActive: !employee.banned,
      },
      ...summary,
      // Норма и отсутствия — то, без чего «отработано» не с чем сравнивать
      normMinutes: period.normMinutes,
      normMinutesBeforeAbsences: period.normMinutesBeforeAbsences,
      workingDays: period.workingDays,
      absenceDays: period.absenceDays,
      utilizationPercent:
        period.normMinutes > 0
          ? Math.round((summary.totalMinutes / period.normMinutes) * 100)
          : null,
      timezone: planner.personalTz,
      scheduleSource: planner.scheduleSource,
      hasPersonalSchedule: planner.hasPersonalSchedule,
      ticketsFinished,
      payroll: canSeeMoney ? rowPayroll : stripPayrollMoney(rowPayroll),
    });

    totals.employeesCount += 1;
    if (summary.worksCount > 0) {
      totals.employeesWithWorks += 1;
    }
    totals.worksCount += summary.worksCount;
    totals.ticketsFinished += ticketsFinished;
    totals.totalMinutes += summary.totalMinutes;
    for (const key of ["onSite", "remote", "routineTask"]) {
      totals[key].count += summary[key].count;
      totals[key].minutes += summary[key].minutes;
    }
    totals.normMinutes += period.normMinutes;
    totals.absenceDays += period.absenceDays;
    if (!planner.hasPersonalSchedule) {
      totals.noScheduleCount += 1;
    }
    totals.overtime.roundedMinutes += summary.overtime.roundedMinutes;
    totals.overtime.weekdayMinutes += summary.overtime.weekdayMinutes;
    totals.overtime.weekendMinutes += summary.overtime.weekendMinutes;
    totals.overtime.holidayMinutes += summary.overtime.holidayMinutes;
    totals.overtimePaySum += payroll.overtimePay ?? 0;
    // Переработка есть, а ставки нет — время не попадёт в доплату
    if (payroll.missing.overtimeHourlyRate && summary.overtime.roundedMinutes > 0) {
      totals.missingRateCount += 1;
    }
  }

  rows.sort((a, b) => b.totalMinutes - a.totalMinutes);

  // Разрезы по команде собираются из строк, а не вторым проходом по работам
  const teamByCompany = new Map();
  const teamByCategory = new Map();
  if (includeBreakdown) {
    for (const row of rows) {
      for (const bucket of row.byCompany) {
        const key = bucket._id || "none";
        if (!teamByCompany.has(key)) {
          teamByCompany.set(key, {
            _id: bucket._id,
            alias: bucket.alias,
            minutes: 0,
            worksCount: 0,
            onSiteCount: 0,
            ticketsFinished: 0,
            employeesCount: 0,
          });
        }
        const team = teamByCompany.get(key);
        team.minutes += bucket.minutes;
        team.worksCount += bucket.worksCount;
        team.onSiteCount += bucket.onSiteCount;
        team.ticketsFinished += bucket.ticketsFinished || 0;
        team.employeesCount += 1;
      }
      for (const bucket of row.byCategory) {
        const key = bucket._id || "none";
        if (!teamByCategory.has(key)) {
          teamByCategory.set(key, {
            _id: bucket._id,
            title: bucket.title,
            minutes: 0,
            worksCount: 0,
          });
        }
        const team = teamByCategory.get(key);
        team.minutes += bucket.minutes;
        team.worksCount += bucket.worksCount;
      }
    }
  }

  totals.avgWorkMinutes = totals.worksCount
    ? Math.round(totals.totalMinutes / totals.worksCount)
    : 0;

  // Сумма доплат по команде — деньги: без права её в ответе нет (счётчик
  // сотрудников без ставки остаётся, это про качество данных, а не про суммы)
  if (!canSeeMoney) {
    delete totals.overtimePaySum;
  }

  // Статусы согласования работ выборки — объясняют переключатель approvedOnly
  const byStatus = {};
  for (const work of works) {
    const key = work.finances?.status || "none";
    if (!byStatus[key]) {
      byStatus[key] = { count: 0, minutes: 0 };
    }
    byStatus[key].count += 1;
    byStatus[key].minutes += toMinutes(workDurationMs(work));
  }

  const report = {
    period: {
      from: fromDay.format("YYYY-MM-DD"),
      to: toDay.format("YYYY-MM-DD"),
      days: periodDays,
      isFullMonth,
      timezone: tz,
    },
    approvedOnly,
    settings: {
      weekdayCoefficient: overtimeSettings.weekdayCoefficient,
      weekendCoefficient: overtimeSettings.weekendCoefficient,
      holidayCoefficient: overtimeSettings.holidayCoefficient,
      defaultTariffingPeriodMinutes: overtimeSettings.defaultTariffingPeriodMinutes,
      productionCalendar: {
        isActive: scheduleContext.calendar.isActive,
        country: scheduleContext.calendar.settings.country,
      },
    },
    totals,
    byStatus,
    byCompany: withShares(teamByCompany, totals.totalMinutes),
    byCategory: withShares(teamByCategory, totals.totalMinutes),
    employees: rows,
  };

  if (includePrev) {
    const prevFrom = fromDay.subtract(periodDays, "day").format("YYYY-MM-DD");
    const prevTo = fromDay.subtract(1, "day").format("YYYY-MM-DD");
    const prev = await buildEmployeesSummary({
      from: prevFrom,
      to: prevTo,
      approvedOnly,
      preferences,
      canSeeMoney,
      includePrev: false,
      // Прошлому периоду нужны только итоги — разрезы там никто не читает
      includeBreakdown: false,
    });
    report.prev = { period: prev.period, totals: prev.totals };
  }

  return report;
};

module.exports = { buildEmployeesSummary };
