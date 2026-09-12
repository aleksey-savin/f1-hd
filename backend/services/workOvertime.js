const TicketCategory = require("@/models/ticketCategory");

const { DEFAULT_OVERTIME_SETTINGS } = require("@/utils/overtimeDefaults");
const { MS_PER_MINUTE, toMinutes } = require("@/services/workSummary");
const { eachDayKey } = require("@/services/dateKeys");
// Только листовые модули: workCalendar поднимает mongoose и логгер, и юнит-тест
// чистой арифметики переработок начинал зависеть от прав на каталог логов
// (та же причина, по которой выделены dateKeys и workWindow).
const {
  DAYS_OF_WEEK,
  MINUTES_PER_DAY,
  dayNameOfKey,
  parseTimeOfDay,
  windowMinutes,
  shiftDayKey,
  instantOf,
  buildWindows,
  subtractWindows,
} = require("@/services/workWindow");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Переработки и оплата за них — единственная реализация на бэкенде (канон:
 * «переработки везде считаются одним алгоритмом»).
 *
 * Что меряется относительно чего (2026-09):
 *   • доплата СОТРУДНИКУ — по ЕГО графику: личная версия на дату, а если
 *     личного графика нет — дефолтный график из настроек. Праздники и
 *     отсутствия приходят из services/workCalendar;
 *   • окно обслуживания клиента здесь не участвует НИКОГДА. По нему считается
 *     счёт КЛИЕНТУ (services/servicePlanBilling, pricePerHourNonWorking): это
 *     ответ на «работа вне SLA», а не на «сотрудник переработал».
 * Оба графика задаются в поясе ОРГАНИЗАЦИИ — он же единственный пояс расчёта.
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
    return { kind: "weekend", start: null, end: null, crossesMidnight: false };
  }
  if (day.is24hours) {
    return {
      kind: "work",
      start: 0,
      end: MINUTES_PER_DAY,
      crossesMidnight: false,
    };
  }
  const window = windowMinutes(day.start, day.end);
  if (!window) {
    // Рабочий день с битым или нулевым временем: переработки нет (легаси вело
    // себя так же). Раньше здесь не было и разбора end < start — окно через
    // полночь считалось дважды.
    return { kind: "work", start: null, end: null, crossesMidnight: false };
  }
  return {
    kind: "work",
    start: window.start,
    end: window.end,
    crossesMidnight: window.end > MINUTES_PER_DAY,
  };
};

const NON_WORKING_KINDS = new Set(["weekend", "holiday", "absence"]);

// Страховка от работы с битыми датами: 366 суток покрывают любую реальную
const MAX_DAY_SPAN = 366;

/**
 * Переработка одной работы. Семантика 1:1 со сводным финансовым отчётом:
 * переработка = кусок суток МИНУС объединение окон графика; тип дня выбирает
 * только бакет оплаты. Каждый непокрытый кусок округляется вверх до периода
 * тарификации — число кусков само по себе денежная величина, поэтому склеивать
 * их через границу суток нельзя.
 *
 * Окна берутся с ЗАПАСОМ В ДЕНЬ НАЗАД: смена через полночь принадлежит дню, в
 * котором началась, и её хвост накрывает утро следующего.
 *
 * dayPlanFor(dateKey) отдаёт окно дня и его тип; он же знает про праздники и
 * отсутствия, поэтому эта функция ими не занимается. tz — пояс, в котором
 * режутся сутки.
 */
const calcWorkOvertime = (work, { dayPlanFor, tariffingPeriodMinutes, tz }) => {
  const result = emptyOvertime();

  const startedAt = dayjs(work.startedAt).tz(tz);
  const finishedAt = dayjs(work.finishedAt).tz(tz);

  if (startedAt.valueOf() >= finishedAt.valueOf() || work.withinPlan) {
    return result;
  }

  const firstKey = startedAt.format("YYYY-MM-DD");
  const lastKey = finishedAt.format("YYYY-MM-DD");

  // Страховка от битой finishedAt: прежний while крутился бы до упора
  if (
    (finishedAt.valueOf() - startedAt.valueOf()) / (MS_PER_MINUTE * 60 * 24) >
    MAX_DAY_SPAN
  ) {
    return result;
  }

  const windows = buildWindows(
    dayPlanFor,
    shiftDayKey(firstKey, -1),
    lastKey,
    tz,
  );

  for (const dateKey of eachDayKey(firstKey, lastKey)) {
    const dayFrom = instantOf(dateKey, 0, tz);
    const dayTo = instantOf(shiftDayKey(dateKey, 1), 0, tz);
    const segStart = Math.max(dayFrom, startedAt.valueOf());
    const segEnd = Math.min(dayTo, finishedAt.valueOf());
    if (segEnd <= segStart) {
      continue;
    }

    const plan = dayPlanFor(dateKey) || {
      kind: "weekend",
      start: null,
      end: null,
    };
    const isWorkingDay = !NON_WORKING_KINDS.has(plan.kind);

    // Рабочий день с битым временем переработки не даёт — легаси-поведение,
    // без этой проверки «сегмент минус окна» отдал бы весь день целиком
    if (isWorkingDay && plan.start === null) {
      continue;
    }

    let dayActualMs = 0;
    let dayRoundedMs = 0;
    for (const [from, to] of subtractWindows([segStart, segEnd], windows)) {
      const chunk = to - from;
      dayActualMs += chunk;
      dayRoundedMs += roundUpMs(chunk, tariffingPeriodMinutes);
    }

    if (dayActualMs > 0) {
      result.days.push({
        date: dateKey,
        // Бакет — по дню, в котором минута ФИЗИЧЕСКИ произошла: работа в 07:00
        // первого января праздничная, чья бы смена ни начиналась накануне.
        bucket:
          plan.kind === "holiday"
            ? "holiday"
            : isWorkingDay
              ? "weekday"
              : "weekend",
        actualMinutes: toMinutes(dayActualMs),
        roundedMinutes: toMinutes(dayRoundedMs),
      });
      result.actualMs += dayActualMs;
      result.roundedMs += dayRoundedMs;
    }
  }

  return result;
};

/**
 * Переработка работы с учётом того, есть ли у исполнителя личный график.
 * Единственное место, где сходятся оба пути, — чтобы сводка по сотрудникам и
 * персональный отчёт не разъехались.
 */
const overtimeForWork = (work, { planner, overtimeSettings, orgTz }) => {
  // Доплата СОТРУДНИКУ меряется по ЕГО графику: личная версия на дату →
  // легаси-поле → дефолтный график из настроек. Окно обслуживания клиента в
  // ней не участвует никогда — это другое понятие и другой субъект: по нему
  // выставляется счёт КЛИЕНТУ (services/servicePlanBilling).
  //
  // До 2026-09 у сотрудника без личного графика доплата считалась по окну того
  // клиента, у которого шла работа: человек получал разные переработки за
  // одинаковый вечер в зависимости от того, к кому его послали.
  const tariffingPeriodMinutes = overtimeSettings.defaultTariffingPeriodMinutes;
  const dayPlanFor = planner?.hasPersonalSchedule
    ? planner.dayPlan
    : staticDayPlanner(overtimeSettings.defaultSchedule);

  return {
    overtime: calcWorkOvertime(work, {
      dayPlanFor,
      tariffingPeriodMinutes,
      tz: orgTz,
    }),
    scheduleSource: planner?.hasPersonalSchedule ? "user" : "fallback",
    tariffingPeriodMinutes,
    planTitle: null,
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

  return { categoriesById };
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

// Денежные поля payroll — и в полной форме (персональный отчёт), и в урезанной
// строке сводки по сотрудникам
const PAYROLL_MONEY_KEYS = new Set([
  "salary",
  "overtimeHourlyRate",
  "overtimePay",
  "estimatedTotal",
]);
const PAYROLL_BUCKET_KEYS = new Set(["weekday", "weekend", "holiday"]);

/**
 * Payroll без денег: часы, коэффициенты и флаги missing остаются, суммы и
 * ставка уходят. Деньги в отчётах показываются только обладателю
 * `user.manageFinances` (и каждому — в своём отчёте), поэтому их вырезает
 * сервис, а не прячет интерфейс: иначе они уезжали бы в ответе API.
 */
const stripPayrollMoney = (payroll) => {
  if (!payroll) {
    return payroll;
  }
  const clean = {};
  for (const [key, value] of Object.entries(payroll)) {
    if (PAYROLL_MONEY_KEYS.has(key)) {
      continue;
    }
    clean[key] =
      PAYROLL_BUCKET_KEYS.has(key) && value
        ? { minutes: value.minutes, coefficient: value.coefficient }
        : value;
  }
  return clean;
};

module.exports = {
  DAYS_OF_WEEK,
  parseTimeOfDay,
  emptyOvertime,
  resolveOvertimeSettings,
  calcWorkOvertime,
  staticDayPlanner,
  overtimeForWork,
  buildOvertimeContext,
  isExcludedFromOvertime,
  buildPayroll,
  stripPayrollMoney,
};
