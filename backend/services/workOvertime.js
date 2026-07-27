const ServicePlan = require("@/models/finances/servicePlan");
const TicketCategory = require("@/models/ticketCategory");

const { DEFAULT_OVERTIME_SETTINGS } = require("@/utils/overtimeDefaults");
const { MS_PER_MINUTE, toMinutes } = require("@/services/workSummary");
const {
  DAYS_OF_WEEK,
  dayNameOfKey,
  parseTimeOfDay,
} = require("@/services/workCalendar");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Переработки и оплата за них — единственная реализация на бэкенде (канон:
 * «переработки везде считаются одним алгоритмом»).
 *
 * Что меряется относительно чего (2026-07, «Графики работы»):
 *   • у сотрудника ЗАДАН личный график → окно его дня, его часовой пояс,
 *     праздники и отсутствия производственного календаря (services/workCalendar);
 *   • НЕ задан → прежний путь: окно обслуживания клиента (тариф → компания →
 *     резерв из настроек) и часовой пояс организации. Ничего не меняется, пока
 *     графики не заполнены.
 * Клиентское окно осталось для биллинга клиента (pricePerHourNonWorking) —
 * оно отвечает на «работа вне SLA», а не на «сотрудник переработал».
 */

const roundUpMs = (ms, stepMinutes) =>
  Math.ceil(ms / (stepMinutes * MS_PER_MINUTE)) * (stepMinutes * MS_PER_MINUTE);

const emptyOvertime = () => ({ actualMs: 0, roundedMs: 0, days: [] });

/** Настройки переработок: значения из Preferences поверх дефолтов. */
const resolveOvertimeSettings = (preferences) => {
  const prefOvertime = preferences?.overtime || {};
  const settings = { ...DEFAULT_OVERTIME_SETTINGS };
  for (const [key, value] of Object.entries(prefOvertime)) {
    if (value !== undefined && value !== null) {
      settings[key] = value;
    }
  }
  // Битый/пустой резервный график непредсказуемо пометил бы все дни нерабочими
  if (!settings.defaultSchedule?.Monday) {
    settings.defaultSchedule = DEFAULT_OVERTIME_SETTINGS.defaultSchedule;
  }
  // null у праздничного коэффициента означает «как в выходной» — так выкатка
  // не меняет суммы молча, пока админ не задал своё значение
  if (settings.holidayCoefficient == null) {
    settings.holidayCoefficient = settings.weekendCoefficient;
  }
  return settings;
};

/**
 * План дня из статического недельного графика — путь для сотрудников без
 * личного графика. Производственный календарь здесь НЕ применяется: окно
 * обслуживания клиента про праздники ничего не знает, клиента обслуживают и
 * 12 июня. Форма ответа общая с workCalendar.makePlanner().dayPlan.
 */
const staticDayPlanner = (schedule) => (dateKey) => {
  const day = schedule?.[dayNameOfKey(dateKey)];
  if (!day?.isWorking) {
    return { kind: "weekend", start: null, end: null };
  }
  if (day.is24hours) {
    return { kind: "work", start: 0, end: 24 * 60 };
  }
  const start = parseTimeOfDay(day.start);
  const end = parseTimeOfDay(day.end);
  if (start === null || end === null) {
    // Рабочий день с битым временем: переработки нет (легаси вело себя так же)
    return { kind: "work", start: null, end: null };
  }
  return { kind: "work", start, end };
};

const NON_WORKING_KINDS = new Set(["weekend", "holiday", "absence"]);

/**
 * Переработка одной работы. Семантика 1:1 со сводным финансовым отчётом:
 * в рабочий день — время до начала окна и после его конца, в нерабочий — весь
 * кусок; каждый кусок округляется вверх до периода тарификации.
 *
 * dayPlanFor(dateKey) отдаёт окно дня и его тип; он же знает про праздники и
 * отсутствия, поэтому эта функция ими не занимается. tz — пояс, в котором
 * режутся сутки: сотрудника, если у него есть график, иначе организации.
 */
const calcWorkOvertime = (work, { dayPlanFor, tariffingPeriodMinutes, tz }) => {
  const result = emptyOvertime();

  const startedAt = dayjs(work.startedAt).tz(tz);
  const finishedAt = dayjs(work.finishedAt).tz(tz);

  if (startedAt.valueOf() === finishedAt.valueOf() || work.withinPlan) {
    return result;
  }

  let currentDay = startedAt.startOf("day");
  const lastDay = finishedAt.startOf("day");

  while (currentDay.valueOf() <= lastDay.valueOf()) {
    const dateKey = currentDay.format("YYYY-MM-DD");
    const segStart = Math.max(currentDay.valueOf(), startedAt.valueOf());
    const segEnd = Math.min(currentDay.endOf("day").valueOf(), finishedAt.valueOf());

    const plan = dayPlanFor(dateKey) || { kind: "weekend", start: null, end: null };
    const isWorkingDay = !NON_WORKING_KINDS.has(plan.kind);

    let dayActualMs = 0;
    let dayRoundedMs = 0;

    if (isWorkingDay) {
      if (plan.start !== null && plan.end !== null) {
        const workStart = currentDay.valueOf() + plan.start * MS_PER_MINUTE;
        const workEnd = currentDay.valueOf() + plan.end * MS_PER_MINUTE;

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
        date: dateKey,
        // Праздник оплачивается своим коэффициентом, поэтому у него свой бакет
        bucket: plan.kind === "holiday" ? "holiday" : isWorkingDay ? "weekday" : "weekend",
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

/**
 * Легаси-путь: график и период тарификации для работы — как в сводном отчёте
 * (первый тариф компании, чьи ticketCategories содержат категорию заявки;
 * график тарифа или компании по флагу companyWorkSchedule). Используется, пока
 * у исполнителя не задан личный график.
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

/**
 * Переработка работы с учётом того, есть ли у исполнителя личный график.
 * Единственное место, где сходятся оба пути, — чтобы сводка по сотрудникам и
 * персональный отчёт не разъехались.
 */
const overtimeForWork = (work, { planner, plansByCompany, overtimeSettings, orgTz }) => {
  const resolved = resolveWorkSchedule(work, plansByCompany, overtimeSettings);

  if (planner?.hasPersonalSchedule) {
    return {
      overtime: calcWorkOvertime(work, {
        dayPlanFor: planner.dayPlan,
        tariffingPeriodMinutes: resolved.tariffingPeriodMinutes,
        tz: planner.tz,
      }),
      scheduleSource: "user",
      tariffingPeriodMinutes: resolved.tariffingPeriodMinutes,
      planTitle: resolved.planTitle,
      timezone: planner.tz,
    };
  }

  return {
    overtime: calcWorkOvertime(work, {
      dayPlanFor: staticDayPlanner(resolved.schedule),
      tariffingPeriodMinutes: resolved.tariffingPeriodMinutes,
      tz: orgTz,
    }),
    scheduleSource: resolved.scheduleSource,
    tariffingPeriodMinutes: resolved.tariffingPeriodMinutes,
    planTitle: resolved.planTitle,
    timezone: orgTz,
  };
};

/**
 * Тарифы задействованных компаний и флаги alwaysWithinPlan категорий — двумя
 * запросами на весь набор работ (иначе тарифы читались бы на каждую работу).
 * Работы должны приходить с populate company (servicePlans, workSchedule) и
 * tickets (categoryId).
 */
const buildOvertimeContext = async (works) => {
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
        .map((planRef) =>
          planRef._id ? plansById.get(planRef._id.toString()) : null,
        )
        .filter(Boolean),
    );
  }

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
        // title — для разреза «по категориям заявок» в персональном отчёте
        .select("alwaysWithinPlan title")
        .lean()
    : [];
  const categoriesById = new Map(
    categories.map((category) => [category._id.toString(), category]),
  );

  return { plansByCompany, categoriesById };
};

/**
 * Категория заявки исключена из переработок. Раньше проверялся только ПЕРВЫЙ
 * тикет работы, тогда как график подбирался по всем — на многотикетных работах
 * это расходилось. Достаточно одной исключённой категории.
 */
const isExcludedFromOvertime = (work, categoriesById) =>
  (work.tickets || []).some(
    (ticket) => categoriesById.get(ticket.categoryId?.toString())?.alwaysWithinPlan,
  );

/** Оплата переработок по индивидуальной ставке сотрудника (+ оклад). */
const buildPayroll = (user, overtimeTotals, overtimeSettings, isFullMonth) => {
  const salary = user?.finances?.salary ?? null;
  const rate = user?.finances?.overtimeHourlyRate ?? null;

  const payFor = (minutes, coefficient) =>
    rate == null ? null : Math.round((minutes / 60) * rate * coefficient);

  const buckets = {
    weekday: {
      minutes: overtimeTotals.weekdayMinutes || 0,
      coefficient: overtimeSettings.weekdayCoefficient,
    },
    weekend: {
      minutes: overtimeTotals.weekendMinutes || 0,
      coefficient: overtimeSettings.weekendCoefficient,
    },
    holiday: {
      minutes: overtimeTotals.holidayMinutes || 0,
      coefficient: overtimeSettings.holidayCoefficient,
    },
  };

  for (const bucket of Object.values(buckets)) {
    bucket.pay = payFor(bucket.minutes, bucket.coefficient);
  }

  const overtimePay =
    rate == null
      ? null
      : buckets.weekday.pay + buckets.weekend.pay + buckets.holiday.pay;

  return {
    salary,
    overtimeHourlyRate: rate,
    ...buckets,
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

module.exports = {
  DAYS_OF_WEEK,
  parseTimeOfDay,
  emptyOvertime,
  resolveOvertimeSettings,
  calcWorkOvertime,
  staticDayPlanner,
  resolveWorkSchedule,
  overtimeForWork,
  buildOvertimeContext,
  isExcludedFromOvertime,
  buildPayroll,
};
