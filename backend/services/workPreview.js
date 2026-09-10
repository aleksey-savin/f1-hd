const {
  dayNameOfKey,
  shiftDayKey,
} = require("@/services/workWindow");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const Company = require("@/models/company");
const Preferences = require("@/models/preferences");
const ServicePlan = require("@/models/finances/servicePlan");
const TicketCategory = require("@/models/ticketCategory");
const { Ticket } = require("@/models/ticket");

const {
  MS_PER_MINUTE,
  DAYS_OF_WEEK,
  dayWindow,
  eachDay,
  isZeroLength,
  calcSingleWorkOvertime,
  normalizePlan,
  resolveSchedule,
} = require("@/services/servicePlanBilling");
const { resolveTimezone } = require("@/utils/datetime");

/**
 * Переработка и предварительная доплата по ОДНОЙ работе: пока инженер
 * заполняет форму (`previewWork`) и в строке работы на карточке заявки
 * (`annotateWorks`).
 *
 * Считает не своим кодом, а тем же, которым выставляется счёт
 * (`services/servicePlanBilling`): переработку — `calcSingleWorkOvertime`,
 * окно дня — `dayWindow`, тариф — `normalizePlan`. График читается в поясе
 * ОРГАНИЗАЦИИ — в нём он и задаётся (см. docs/datetime-conventions.md). До
 * 2026-07 предпросмотр жил в браузере (`frontend/src/util/finances.js`) и читал
 * график в поясе ОПЕРАТОРА, из-за чего расходился со счётом. Здесь второй
 * методики нет по построению.
 *
 * Деньги отдаются только тем, кому положено: без права ключа `money` в ответе
 * нет вовсе — прятать сумму в браузере бессмысленно, она уже приехала.
 */

const DAY_TITLES = {
  Monday: "Понедельник",
  Tuesday: "Вторник",
  Wednesday: "Среда",
  Thursday: "Четверг",
  Friday: "Пятница",
  Saturday: "Суббота",
  Sunday: "Воскресенье",
};

const DAY_SHORT = {
  Monday: "Пн",
  Tuesday: "Вт",
  Wednesday: "Ср",
  Thursday: "Чт",
  Friday: "Пт",
  Saturday: "Сб",
  Sunday: "Вс",
};

/**
 * Недельный график одной строкой: «Пн–Пт, 09:00–18:00 · Сб, 10:00–15:00».
 * Подряд идущие дни с одинаковым окном сливаются в диапазон — иначе строка не
 * помещается ни в форму, ни в мобильную шторку.
 */
const describeScheduleLine = (schedule) => {
  const groups = [];

  DAYS_OF_WEEK.forEach((key, index) => {
    const day = schedule?.[key];
    if (!day || !day.isWorking) {
      return;
    }

    const window =
      day.is24hours || !day.start || !day.end
        ? "круглосуточно"
        : `${day.start}–${day.end}`;
    const last = groups[groups.length - 1];

    if (last && last.window === window && last.to === index - 1) {
      last.to = index;
      return;
    }

    groups.push({ from: index, to: index, window });
  });

  if (groups.length === 0) {
    return null;
  }

  return groups
    .map((group) => {
      const days =
        group.from === group.to
          ? DAY_SHORT[DAYS_OF_WEEK[group.from]]
          : `${DAY_SHORT[DAYS_OF_WEEK[group.from]]}–${DAY_SHORT[DAYS_OF_WEEK[group.to]]}`;
      return `${days}, ${group.window}`;
    })
    .join(" · ");
};

/**
 * Почему время оказалось вне графика. Обходит те же сутки, что и расчёт
 * (общий `eachDay`), и называет причину словами: цифру, которую нечем
 * проверить, спора не выдерживает — графика услуги в форме не видно.
 */
const describeOvertime = (schedule, work, zone) => {
  const kinds = new Set();
  let firstNonWorkingDay = null;
  let openAt = null;
  let closeAt = null;

  for (const { dateKey, dayStart, dayEnd } of eachDay(work, zone)) {
    if (dayEnd <= dayStart) {
      continue;
    }

    // Хвост вчерашней смены накрывает утро: окно предыдущего дня тоже считается
    const window = dayWindow(schedule, dateKey, zone);
    const tail = dayWindow(schedule, shiftDayKey(dateKey, -1), zone);
    const coveredByTail = tail && tail.workEnd > dayStart && tail.workStart <= dayStart;

    if (!window) {
      if (coveredByTail && tail.workEnd >= dayEnd) {
        continue;
      }
      kinds.add("nonWorkingDay");
      firstNonWorkingDay = firstNonWorkingDay ?? DAY_TITLES[dayNameOfKey(dateKey)];
      continue;
    }

    if (dayStart < window.workStart && !coveredByTail) {
      kinds.add("beforeOpen");
      openAt = openAt ?? dayjs(window.workStart).tz(zone).format("HH:mm");
    }

    if (dayEnd > window.workEnd) {
      kinds.add("afterClose");
      closeAt = closeAt ?? dayjs(window.workEnd).tz(zone).format("HH:mm");
    }
  }

  if (kinds.size === 0) {
    return null;
  }

  if (kinds.size > 1) {
    return {
      kind: "mixed",
      text: "Работа частью попадает в нерабочее время по графику обслуживания",
    };
  }

  const [kind] = kinds;

  if (kind === "nonWorkingDay") {
    return {
      kind,
      text: `${firstNonWorkingDay} — нерабочий день по графику обслуживания`,
    };
  }

  if (kind === "beforeOpen") {
    return {
      kind,
      text: `Работа начата до открытия — обслуживание начинается в ${openAt}`,
    };
  }

  return {
    kind,
    text: `Работа продолжалась после закрытия — обслуживание заканчивается в ${closeAt}`,
  };
};

/** Услуга компании, которая покрывает хотя бы одну категорию из набора заявок. */
const findPlan = async (company, categoryIds) => {
  const attachedIds = (company.servicePlans || []).map((attachment) =>
    String(attachment._id),
  );
  if (attachedIds.length === 0) {
    return null;
  }

  const plans = await ServicePlan.find({ _id: { $in: attachedIds } }).lean();

  return (
    plans.find((plan) =>
      (plan.ticketCategories || []).some((category) =>
        categoryIds.has(String(category._id)),
      ),
    ) || null
  );
};

/**
 * Компания, услуга, график и пояс — один раз на набор заявок. Возвращает null,
 * если тарифицировать нечем: у компании нет подходящей услуги.
 */
const loadContext = async (tickets) => {
  const categoryIds = new Set(
    tickets.map((ticket) => String(ticket.categoryId)).filter(Boolean),
  );

  const company = await Company.findById(tickets[0].company?._id)
    .select("workSchedule timezone servicePlans")
    .lean();
  if (!company) {
    return null;
  }

  const plan = await findPlan(company, categoryIds);
  if (!plan) {
    return null;
  }

  const preferences = await Preferences.findOne({}).lean();

  return {
    tariff: normalizePlan(plan),
    schedule: resolveSchedule(plan, company),
    zone: resolveTimezone(preferences),
  };
};

/** Категории со снятой тарификацией (`alwaysWithinPlan`) — по id категории. */
const loadAlwaysWithinPlan = async (categoryIds) => {
  const categories = await TicketCategory.find({
    _id: { $in: [...categoryIds] },
    alwaysWithinPlan: true,
  })
    .select("title")
    .lean();

  return new Map(categories.map((category) => [String(category._id), category]));
};

/** Переработка и доплата по одной работе в уже загруженном контексте. */
const calcFor = ({ context, work, canSeeMoney }) => {
  const { schedule, tariff, zone } = context;

  const { actualOvertime, roundUpOvertime } = calcSingleWorkOvertime(
    schedule,
    work,
    tariff.tariffingPeriod,
    zone,
  );

  if (actualOvertime <= 0) {
    return null;
  }

  const result = {
    actualMinutes: Math.round(actualOvertime / MS_PER_MINUTE),
    roundedMinutes: Math.round(roundUpOvertime / MS_PER_MINUTE),
  };

  // У почасового тарифа доп. оплаты не бывает вовсе (priceWorks:
  // additionalPrice = 0) — сумму не отдаём никому, иначе интерфейс пообещает
  // счёт, которого не будет
  if (canSeeMoney && tariff.type !== "hourly") {
    result.money = {
      tariffingPeriod: tariff.tariffingPeriod,
      pricePerHourNonWorking: tariff.pricePerHourNonWorking,
      // Та же формула, что в priceWorks: минуты переработки × ставка / 60
      cost: Math.round(
        ((roundUpOvertime / MS_PER_MINUTE) * tariff.pricePerHourNonWorking) / 60,
      ),
    };
  }

  return result;
};

/**
 * Предпросмотр для формы работы.
 *
 * Переработка считается ВСЕГДА как если бы работа тарифицировалась, даже когда
 * инженер уже поставил «учесть в рабочее время»: иначе включённый переключатель
 * нечем подписать («выключите, чтобы вернуть доплату 4 000 ₽»), а выключить его
 * обратно можно было бы только по памяти. Что из этого показать, решает форма —
 * состояние переключателя она и так держит, и лишний запрос на его щелчок не
 * нужен.
 *
 * @param {Object} input
 * @param {string[]} input.ticketIds заявки работы (первая задаёт компанию — как в `add`)
 * @param {string|Date} input.startedAt
 * @param {string|Date} input.finishedAt
 * @param {boolean} input.canSeeMoney право видеть суммы и условия тарифа
 */
const previewWork = async ({
  ticketIds,
  startedAt,
  finishedAt,
  canSeeMoney = false,
}) => {
  const empty = {
    hasServicePlan: false,
    alwaysWithinPlan: false,
    alwaysWithinPlanCategory: null,
    tariffType: null,
    schedule: null,
    overtime: null,
  };

  const ids = (ticketIds || []).filter(Boolean);
  if (ids.length === 0) {
    return empty;
  }

  const tickets = await Ticket.find({ _id: { $in: ids } })
    .select("company categoryId")
    .lean();
  if (tickets.length === 0) {
    return empty;
  }

  // Признак «всегда в графике» — по ВСЕМ заявкам работы, а не по первой:
  // массовое добавление вешает одну работу на несколько заявок, и категории у
  // них разные (то же правило в workOvertime.isExcludedFromOvertime)
  const categoryIds = new Set(
    tickets.map((ticket) => String(ticket.categoryId)).filter(Boolean),
  );
  const exempt = await loadAlwaysWithinPlan(categoryIds);
  const exemptCategory = [...exempt.values()][0] || null;

  const context = await loadContext(tickets);
  if (!context) {
    return { ...empty, alwaysWithinPlan: Boolean(exemptCategory) };
  }

  const base = {
    hasServicePlan: true,
    alwaysWithinPlan: Boolean(exemptCategory),
    alwaysWithinPlanCategory: exemptCategory?.title || null,
    tariffType: context.tariff.type,
    schedule: describeScheduleLine(context.schedule),
    overtime: null,
  };

  const work = { startedAt, finishedAt, withinPlan: false };

  // Нулевая длительность гасит расчёт там же, где и в биллинге. Льготная
  // категория — тоже: у неё доплаты не бывает, и показывать «сколько бы вышло»
  // не за что зацепиться, рычага там нет
  if (isZeroLength(work) || exemptCategory) {
    return base;
  }

  const overtime = calcFor({ context, work, canSeeMoney });
  if (!overtime) {
    return base;
  }

  base.overtime = {
    ...overtime,
    reason: describeOvertime(context.schedule, work, context.zone),
  };

  return base;
};

/**
 * Пометка «доп. оплата» для строк работ на карточке заявки. Возвращает объект
 * `{ [workId]: { actualMinutes, roundedMinutes, money? } }` только для тех
 * работ, что вышли за график: в списке показываем исключение, а не норму.
 */
const annotateWorks = async ({ works, canSeeMoney = false }) => {
  const finished = (works || []).filter(
    (work) => work.startedAt && work.finishedAt && !work.withinPlan,
  );
  if (finished.length === 0) {
    return {};
  }

  const ticketIds = [
    ...new Set(
      finished.flatMap((work) =>
        (work.tickets || []).map((ticket) => String(ticket?._id || ticket)),
      ),
    ),
  ];

  const tickets = await Ticket.find({ _id: { $in: ticketIds } })
    .select("company categoryId")
    .lean();
  if (tickets.length === 0) {
    return {};
  }

  const categoryByTicket = new Map(
    tickets.map((ticket) => [String(ticket._id), String(ticket.categoryId)]),
  );
  const exempt = await loadAlwaysWithinPlan(new Set(categoryByTicket.values()));

  const context = await loadContext(tickets);
  if (!context) {
    return {};
  }

  const annotated = {};

  for (const work of finished) {
    const isExempt = (work.tickets || []).some((ticket) =>
      exempt.has(categoryByTicket.get(String(ticket?._id || ticket))),
    );
    if (isExempt) {
      continue;
    }

    const overtime = calcFor({ context, work, canSeeMoney });
    if (overtime) {
      annotated[String(work._id)] = overtime;
    }
  }

  return annotated;
};

module.exports = {
  previewWork,
  annotateWorks,
  describeScheduleLine,
  describeOvertime,
};
