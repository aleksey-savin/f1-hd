const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const Company = require("@/models/company");
const Preferences = require("@/models/preferences");
const ServicePlan = require("@/models/finances/servicePlan");
const TicketCategory = require("@/models/ticketCategory");

const { loadWorks } = require("@/services/workSummary");
const { normalizeTimezone } = require("@/services/clientTimezone");
const { resolveTimezone } = require("@/utils/datetime");

/**
 * Биллинг работ по услуге — единственный источник правды по деньгам.
 *
 * До этого сервиса часы и суммы считал браузер (frontend/src/util/finances.js
 * + PreviewTable.jsx) и присылал результат скрытыми полями формы; сервер
 * записывал присланное не глядя. Согласовывать клиенту цифру, которую посчитал
 * чей-то браузер, нельзя — расчёт переехал сюда.
 *
 * СЕМАНТИКА ПЕРЕНЕСЕНА 1:1 (см. docs/ux-ui-guide.md и память проекта:
 * переработки во всех отчётах обязаны считаться одинаково). Осознанных
 * отступлений ровно два, оба — исправления, а не «улучшения расчёта»:
 *
 *  1. ТАЙМЗОНА. Оригинал резолвил день и часы графика через new Date(...)
 *     .getHours()/.getDay(), то есть в поясе браузера оператора. На сервере
 *     это был бы UTC — при Preferences.timezone = Asia/Vladivostok почти вся
 *     работа выпала бы за окно 09:00–18:00 и стала переработкой (на снимке
 *     dev-базы: 620 532 ₽ → 883 284 ₽, +42 %, разошлись 15 строк из 19).
 *     Здесь график читается в поясе КЛИЕНТА (Company.timezone, при пустом —
 *     Preferences.timezone), как и предписывает docs/datetime-conventions.md
 *     («График работы клиента»). Пока ни у одной компании своего пояса нет,
 *     это ровно прежние цифры.
 *  2. КРУГЛОСУТОЧНЫЙ ДЕНЬ. Редактор графика пишет `{is24hours:true,
 *     start:"", end:""}`, а оригинал делал Number("") → NaN, и все сравнения
 *     с ним давали false: такой день не приносил НИ оплачиваемого времени, НИ
 *     переработки — работа молча пропадала из счёта. Здесь is24hours (и день
 *     с пустым временем при isWorking) считается рабочим целиком.
 *     В dev-базе таких дней нет, на прод — проверить перед выкаткой.
 *
 * Всё остальное сохранено дословно, включая странности: `withinPlan` выключает
 * и нарезку по графику, и переработку; признак alwaysWithinPlan берётся у
 * категории ПЕРВОЙ заявки работы; у почасового тарифа доп. оплаты не бывает;
 * packagesNonWorkingCalcMethod/Coefficient в расчёте не участвуют.
 */

const MS_PER_MINUTE = 60 * 1000;

// Индекс дня недели → ключ графика; (dayjs.day() + 6) % 7 даёт понедельник = 0
const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

// Страховка от работы с битыми датами: 366 суток покрывают любую реальную
const MAX_DAY_SPAN = 366;

const roundUp = (value, multiple) =>
  multiple > 0 ? Math.ceil(value / multiple) * multiple : value;

const hasBothMarks = (work) => Boolean(work?.startedAt && work?.finishedAt);

/** Нулевая длительность — работу не тарифицируем (как в оригинале). */
const isZeroLength = (work) =>
  !hasBothMarks(work) ||
  new Date(work.startedAt).getTime() === new Date(work.finishedAt).getTime();

/**
 * Окно графика на конкретный календарный день в поясе клиента.
 * null — день нерабочий (в оригинале: `daySchedule && daySchedule.isWorking`).
 */
const dayWindow = (schedule, cursor) => {
  const day = schedule?.[DAYS_OF_WEEK[(cursor.day() + 6) % 7]];
  if (!day || !day.isWorking) {
    return null;
  }

  // Круглосуточный день: время не задано, работает весь день (см. отступление 2)
  if (day.is24hours || !day.start || !day.end) {
    return {
      workStart: cursor.startOf("day").valueOf(),
      workEnd: cursor.endOf("day").valueOf(),
    };
  }

  const [startHour, startMinute] = String(day.start).split(":").map(Number);
  const [endHour, endMinute] = String(day.end).split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) {
    return null;
  }

  return {
    workStart: cursor
      .hour(startHour)
      .minute(startMinute)
      .second(0)
      .millisecond(0)
      .valueOf(),
    workEnd: cursor
      .hour(endHour)
      .minute(endMinute)
      .second(0)
      .millisecond(0)
      .valueOf(),
  };
};

/**
 * Нарезка работы на календарные дни пояса клиента.
 * Повторяет цикл оригинала: currentDate — полночь дня начала, шаг сутки до дня
 * окончания; dayStart/dayEnd — пересечение суток с отметками работы.
 */
const eachDay = function* (work, zone) {
  const started = dayjs(work.startedAt).tz(zone);
  const finished = dayjs(work.finishedAt).tz(zone);
  const lastDay = finished.startOf("day");

  let cursor = started.startOf("day");
  let guard = 0;
  while (!cursor.isAfter(lastDay) && guard < MAX_DAY_SPAN) {
    guard += 1;
    yield {
      cursor,
      dayStart: Math.max(cursor.valueOf(), started.valueOf()),
      dayEnd: Math.min(cursor.endOf("day").valueOf(), finished.valueOf()),
    };
    cursor = cursor.add(1, "day");
  }
};

/** Порт calcSingleWorkOvertime: время вне графика + нерабочие дни целиком. */
const calcSingleWorkOvertime = (schedule, work, tariffingPeriod, zone) => {
  if (isZeroLength(work) || work.withinPlan) {
    return { actualOvertime: 0, roundUpOvertime: 0 };
  }

  const periodMs = tariffingPeriod * MS_PER_MINUTE;
  let actualOvertime = 0;
  let roundUpOvertime = 0;

  for (const { cursor, dayStart, dayEnd } of eachDay(work, zone)) {
    const window = dayWindow(schedule, cursor);

    if (!window) {
      // Нерабочий день — всё время работы в нём переработка
      const overtime = dayEnd - dayStart;
      actualOvertime += overtime;
      roundUpOvertime += roundUp(overtime, periodMs);
      continue;
    }

    // До начала рабочего дня
    if (dayStart < window.workStart) {
      const overtime = Math.min(window.workStart - dayStart, dayEnd - dayStart);
      actualOvertime += overtime;
      roundUpOvertime += roundUp(overtime, periodMs);
    }

    // После окончания рабочего дня
    if (dayEnd > window.workEnd) {
      const overtime = dayEnd - Math.max(window.workEnd, dayStart);
      actualOvertime += overtime;
      roundUpOvertime += roundUp(overtime, periodMs);
    }
  }

  return { actualOvertime, roundUpOvertime };
};

/** Порт calculateOvertime: сумма переработки набора, в минутах. */
const calcOvertime = (schedule, works, tariffingPeriod, zone) => {
  let overtime = 0;
  const overtimeWorks = [];

  for (const work of works) {
    if (isZeroLength(work)) {
      continue;
    }
    const { roundUpOvertime } = calcSingleWorkOvertime(
      schedule,
      work,
      tariffingPeriod,
      zone,
    );
    overtime += roundUpOvertime / MS_PER_MINUTE;
    if (roundUpOvertime > 0 && !work.withinPlan) {
      overtimeWorks.push({
        work,
        minutes: roundUpOvertime / MS_PER_MINUTE,
        actualMs: roundUpOvertime,
      });
    }
  }

  return { overtime, overtimeWorks };
};

/**
 * Порт calculateWorkTime: время внутри графика (у withinPlan — вся
 * длительность), в минутах; roundedWorktime округляет каждую работу вверх до
 * периода тарификации.
 */
const calcWorkTime = (schedule, works, tariffingPeriod, zone) => {
  const periodMs = tariffingPeriod * MS_PER_MINUTE;
  let worktime = 0;
  let roundedWorktime = 0;
  const worktimeWorks = [];

  for (const work of works) {
    if (isZeroLength(work)) {
      continue;
    }

    let total = 0;
    if (work.withinPlan) {
      total =
        new Date(work.finishedAt).getTime() - new Date(work.startedAt).getTime();
    } else {
      for (const { cursor, dayStart, dayEnd } of eachDay(work, zone)) {
        const window = dayWindow(schedule, cursor);
        if (!window) {
          continue;
        }
        const effectiveStart = Math.max(dayStart, window.workStart);
        const effectiveEnd = Math.min(dayEnd, window.workEnd);
        if (effectiveEnd > effectiveStart) {
          total += effectiveEnd - effectiveStart;
        }
      }
    }

    worktime += Math.round(total / MS_PER_MINUTE);
    const rounded = Math.round(roundUp(total, periodMs) / MS_PER_MINUTE);
    roundedWorktime += rounded;
    // В набор попадают только работы, реально принёсшие время в графике:
    // нулевые в таблицу не идут (так же вело себя calculateWorkTime)
    if (total > 0) {
      worktimeWorks.push({ work, minutes: rounded, actualMs: total });
    }
  }

  return { worktime, roundedWorktime, worktimeWorks };
};

/** Порт calcRoundedWorkTime/overallRoundedWorktime: длительность без графика. */
const overallRoundedWorktimeMs = (works, tariffingPeriod) => {
  const periodMs = tariffingPeriod * MS_PER_MINUTE;
  return works.reduce((total, work) => {
    if (!hasBothMarks(work)) {
      return total;
    }
    const duration =
      new Date(work.finishedAt).getTime() - new Date(work.startedAt).getTime();
    return total + roundUp(duration, periodMs);
  }, 0);
};

/**
 * Тариф в едином виде. Новая схема (плоские поля) — основная; вложенный
 * `tariffing` остался у старых услуг и читается запасным вариантом, иначе они
 * посчитались бы по нулям.
 */
const normalizePlan = (plan) => {
  const legacy = plan.tariffing || {};
  const type = plan.type || legacy.type || null;
  return {
    type,
    tariffingPeriod: plan.tariffingPeriod || legacy.period || 0,
    hourPackages:
      plan.hourPackages?.length > 0
        ? plan.hourPackages
        : legacy.hourPackage?.packages || [],
    fixedPrice: plan.fixedPrice ?? legacy.fixedPrice?.price ?? 0,
    pricePerHour: plan.pricePerHour ?? legacy.hourly?.pricePerHour ?? 0,
    pricePerHourNonWorking:
      plan.pricePerHourNonWorking ??
      (type === "hourPackage"
        ? legacy.hourPackage?.nonWorkingTime?.pricePerHour
        : legacy[type]?.pricePerHourNonWorking) ??
      0,
  };
};

/**
 * Пакет часов: цена и ОСНОВАНИЕ одним расчётом.
 *
 * Правило в пользу клиента: пока дешевле остаться на текущем пакете и
 * доплатить за часы сверх него по его же ставке — считаем так, и только когда
 * это становится дороже фиксированной цены следующего пакета, переводим на
 * него. Превышение на десять минут не должно стоить как целый следующий пакет.
 *
 * Семантика перенесена из util/finances.js `calculateHourPackagePrice` без
 * изменений — там это уже работало правильно. Здесь она собрана ВМЕСТЕ с
 * основанием: раньше подпись «в какой пакет попал» считалась отдельной
 * функцией по другому правилу и врала — на 24:10 деньги шли по ставке
 * 24-часового пакета, а карточка писала «Пакет 48 ч».
 *
 * `basis.mode`:
 *   package  — заплачена фиксированная цена пакета basis.hours;
 *   overflow — клиент остался на пакете basis.hours и доплачивает за часы
 *              сверх него по его же ставке (так дешевле).
 */
const priceHourPackage = (tariff, workingTimeHours) => {
  const packages = [...(tariff.hourPackages || [])].sort(
    (left, right) => left.hours - right.hours,
  );
  if (packages.length === 0) {
    return { price: 0, basis: null };
  }

  const fit = packages.find((item) => workingTimeHours <= item.hours);
  let price = fit ? fit.hours * fit.pricePerHour : 0;
  let basis = fit
    ? { hours: fit.hours, pricePerHour: fit.pricePerHour, mode: "package" }
    : null;

  // Вышли за самый большой пакет — дальше считается по его ставке
  if (!fit) {
    const last = packages[packages.length - 1];
    price = workingTimeHours * last.pricePerHour;
    basis = {
      hours: last.hours,
      pricePerHour: last.pricePerHour,
      mode: "overflow",
    };
  }

  // Превышен младший пакет — сравниваем с «остаться на нём и доплатить»
  const exceeded = packages.filter((item) => workingTimeHours > item.hours).pop();
  if (exceeded) {
    const stayPrice = workingTimeHours * exceeded.pricePerHour;
    if (stayPrice < price) {
      return {
        price: stayPrice,
        basis: {
          hours: exceeded.hours,
          pricePerHour: exceeded.pricePerHour,
          mode: "overflow",
        },
      };
    }
  }

  return { price, basis };
};

/**
 * График оказания: график компании либо собственный у услуги.
 *
 * Проверка именно на истинность, а не `=== false`: у части услуг в базе
 * `companyWorkSchedule: null` (поле появилось позже их создания), и оригинал
 * трактует это как «свой график услуги». Строгое сравнение переключило бы их
 * на график компании и сдвинуло суммы.
 */
const resolveSchedule = (plan, company) =>
  plan.companyWorkSchedule ? company?.workSchedule : plan.customProvisionSchedule;

/**
 * Состояние графика обслуживания — чтобы карточка не рисовала сетку вслепую.
 *
 * В базе встречается вырожденный график: все семь дней «рабочие» с 00:00 до
 * 00:00. Это НЕ круглосуточно и НЕ выходные — окно нулевое, и по формуле всё
 * время работ уходит в переработку и оплачивается сверх тарифа. Сетка из
 * нулей это скрывает, поэтому такое состояние называется словами.
 *
 * У почасового тарифа график в расчёте не участвует вовсе (доп. оплаты нет) —
 * показывать его сеткой значит врать о том, что от него что-то зависит.
 */
const describeSchedule = (plan, company) => {
  const source = plan.companyWorkSchedule ? "company" : "plan";
  const schedule = resolveSchedule(plan, company);
  const tariff = normalizePlan(plan);

  if (tariff.type === "hourly") {
    return { state: "notApplicable", source, days: null };
  }

  const working = DAYS_OF_WEEK.map((key) => schedule?.[key]).filter(
    (day) => day && day.isWorking,
  );

  if (working.length === 0) {
    return { state: "empty", source, days: null };
  }
  if (working.every((day) => day.is24hours)) {
    return { state: "always", source, days: null };
  }
  // Все рабочие дни с нулевым окном — график заведён, но не заполнен
  if (working.every((day) => !day.start || !day.end || day.start === day.end)) {
    return { state: "degenerate", source, days: null };
  }

  return { state: "ok", source, days: schedule };
};

/**
 * Расчёт одной пары «компания × услуга» за набор работ.
 * Возвращает и разбивку на рабочее/нерабочее время — карточка отчёта показывает
 * работы одним списком с фасетом, и обе группы ей нужны отсюда, а не из
 * повторного счёта на клиенте.
 */
const priceWorks = ({ plan, company, works, zone, categoryById }) => {
  const tariff = normalizePlan(plan);
  const schedule = resolveSchedule(plan, company);

  const workingTimeMinutes =
    tariff.type === "hourly"
      ? overallRoundedWorktimeMs(works, tariff.tariffingPeriod) / MS_PER_MINUTE
      : calcWorkTime(schedule, works, tariff.tariffingPeriod, zone)
          .roundedWorktime;

  let price = 0;
  let packageBasis = null;
  if (tariff.type === "hourPackage") {
    const packaged = priceHourPackage(tariff, workingTimeMinutes / 60);
    price = packaged.price;
    packageBasis = packaged.basis;
  } else if (tariff.type === "hourly") {
    price =
      ((overallRoundedWorktimeMs(works, tariff.tariffingPeriod) /
        MS_PER_MINUTE) *
        tariff.pricePerHour) /
      60;
  } else {
    price = tariff.fixedPrice;
  }

  // Доп. оплата — только за работы вне графика и только у непочасовых тарифов.
  // Категория ПЕРВОЙ заявки с alwaysWithinPlan выводит работу из переработки.
  const billableForOvertime = works.filter((work) => {
    const category = categoryById?.get(
      String(work.tickets?.[0]?.categoryId?._id ?? work.tickets?.[0]?.categoryId),
    );
    return !category?.alwaysWithinPlan;
  });

  const { overtime, overtimeWorks } =
    tariff.type === "hourly"
      ? { overtime: 0, overtimeWorks: [] }
      : calcOvertime(
          resolveSchedule(plan, company),
          billableForOvertime,
          tariff.tariffingPeriod,
          zone,
        );

  const additionalPrice =
    tariff.type === "hourly" ? 0 : (overtime * tariff.pricePerHourNonWorking) / 60;

  // Две группы работ — ровно то, что показывал прежний экран двумя таблицами:
  // «выполнены в нерабочее время» и «выполнены в рабочее время». Работа может
  // попасть в обе (часть смены внутри графика, часть вне), а нулевая — ни в
  // одну; одним списком с фасетом это не выражается.
  const periodMs = tariff.tariffingPeriod * MS_PER_MINUTE;
  const worktimeDetail =
    tariff.type === "hourly"
      ? // У почасового тарифа график не режет время: платится вся длительность,
        // округлённая до периода тарификации, и таблица нерабочего времени не
        // показывается вовсе
        works
          .filter((work) => !isZeroLength(work))
          .map((work) => ({
            work,
            minutes:
              roundUp(
                new Date(work.finishedAt) - new Date(work.startedAt),
                periodMs,
              ) / MS_PER_MINUTE,
          }))
      : calcWorkTime(schedule, works, tariff.tariffingPeriod, zone)
          .worktimeWorks;

  const rate = tariff.pricePerHourNonWorking || 0;

  return {
    tariff,
    schedule,
    workingTimeMinutes,
    overtimeMinutes: overtime,
    price,
    packageBasis,
    additionalPrice,
    total: price + additionalPrice,
    worktimeWorks: worktimeDetail.map((item) => ({
      workId: item.work._id,
      minutes: item.minutes,
    })),
    overtimeWorks: overtimeWorks.map((item) => ({
      workId: item.work._id,
      minutes: item.minutes,
      cost: (item.minutes * rate) / 60,
    })),
    overtimeWorkIds: overtimeWorks.map((item) => String(item.work._id)),
  };
};

/** Пояс, в котором читается график компании: свой → организации. */
const companyZone = (company, orgZone) =>
  normalizeTimezone(company?.timezone) || orgZone;

/**
 * Момент, с которого компания вообще обслуживается: самая ранняя привязка
 * услуги. Работы по заявкам, заведённым раньше, в биллинг не попадают
 * (правило унаследовано от summaryReportPreview).
 */
const serviceStartOf = (company) =>
  (company.servicePlans || []).reduce(
    (earliest, attachment) =>
      attachment.isActiveSince && attachment.isActiveSince < earliest
        ? attachment.isActiveSince
        : earliest,
    new Date(),
  );

/** Заявка относится к услуге, если её категория есть в списке категорий услуги. */
const planCategoryIds = (plan) =>
  new Set((plan.ticketCategories || []).map((category) => String(category._id)));

/**
 * Превью биллинга: всё, что выполнено, но ещё не вошло ни в один отчёт,
 * разложенное по «месяц × компания × услуга» с посчитанными часами и суммами.
 *
 * Период необязателен намеренно: очередь на выставление не ограничена месяцем,
 * и забытый май обязан оставаться видимым. Сужение периода — дело интерфейса.
 */
const buildPreview = async ({ from = null, to = null, companyIds = null } = {}) => {
  const preferences = await Preferences.findOne({}).lean();
  const orgZone = resolveTimezone(preferences);

  const companyQuery = { servicePlans: { $not: { $size: 0 } } };
  if (companyIds) {
    companyQuery._id = { $in: companyIds };
  }

  const [companies, categories] = await Promise.all([
    Company.find(companyQuery)
      .select("alias fullTitle workSchedule timezone servicePlans")
      .lean(),
    TicketCategory.find({}).select("title alwaysWithinPlan").lean(),
  ]);

  const categoryById = new Map(
    categories.map((category) => [String(category._id), category]),
  );

  const attachedPlanIds = [
    ...new Set(
      companies.flatMap((company) =>
        (company.servicePlans || []).map((attachment) =>
          String(attachment._id),
        ),
      ),
    ),
  ];

  const plans = await ServicePlan.find({ _id: { $in: attachedPlanIds } }).lean();
  const planById = new Map(plans.map((plan) => [String(plan._id), plan]));

  const works = await loadWorks({
    from,
    to,
    companyIds: companies.map((company) => company._id),
    withTickets: true,
    ticketSelect: "num categoryId applicantId createdAt",
    extraSelect: "withinPlan description finances",
    financeStatuses: [null, "preview"],
  });

  const worksByCompany = new Map();
  for (const work of works) {
    const key = String(work.company);
    if (!worksByCompany.has(key)) {
      worksByCompany.set(key, []);
    }
    worksByCompany.get(key).push(work);
  }

  const rows = [];

  for (const company of companies) {
    const companyWorks = worksByCompany.get(String(company._id)) || [];
    if (companyWorks.length === 0) {
      continue;
    }

    const zone = companyZone(company, orgZone);
    const serviceStart = serviceStartOf(company);
    const attachments = new Map(
      (company.servicePlans || []).map((attachment) => [
        String(attachment._id),
        attachment,
      ]),
    );

    // Заявки, заведённые до начала обслуживания, к биллингу не относятся
    const billable = companyWorks.filter((work) =>
      (work.tickets || []).some(
        (ticket) => ticket?.createdAt && ticket.createdAt >= serviceStart,
      ),
    );
    if (billable.length === 0) {
      continue;
    }

    const companyPlans = [...attachments.keys()]
      .map((planId) => planById.get(planId))
      .filter(Boolean);

    // Категории всех услуг компании — работа вне них не тарифицируется ничем
    const coveredCategories = new Set(
      companyPlans.flatMap((plan) => [...planCategoryIds(plan)]),
    );

    const byMonth = new Map();
    for (const work of billable) {
      const month = dayjs(work.finishedAt).tz(zone).format("YYYY-MM");
      if (!byMonth.has(month)) {
        byMonth.set(month, []);
      }
      byMonth.get(month).push(work);
    }

    for (const [month, monthWorks] of byMonth) {
      // Работы вне услуг блокируют формирование отчёта у всей компании за
      // месяц — их надо не только сосчитать, но и показать: иначе непонятно,
      // что именно чинить
      const unrelated = monthWorks.filter((work) =>
        (work.tickets || []).some(
          (ticket) =>
            ticket?.createdAt &&
            ticket.createdAt >= serviceStart &&
            !coveredCategories.has(String(ticket.categoryId)),
        ),
      );

      for (const plan of companyPlans) {
        const planCategories = planCategoryIds(plan);
        const planWorks = monthWorks.filter((work) =>
          (work.tickets || []).some(
            (ticket) =>
              ticket?.createdAt &&
              ticket.createdAt >= serviceStart &&
              planCategories.has(String(ticket.categoryId)),
          ),
        );
        if (planWorks.length === 0) {
          continue;
        }

        const priced = priceWorks({
          plan,
          company,
          works: planWorks,
          zone,
          categoryById,
        });

        rows.push({
          month,
          company: {
            _id: company._id,
            alias: company.alias,
            fullTitle: company.fullTitle,
          },
          servicePlan: {
            _id: plan._id,
            title: plan.title,
            type: priced.tariff.type,
            tariffingPeriod: priced.tariff.tariffingPeriod,
            pricePerHourNonWorking: priced.tariff.pricePerHourNonWorking,
            pricePerHour: priced.tariff.pricePerHour,
            hourPackages: priced.tariff.hourPackages,
          },
          approval: {
            required: Boolean(
              attachments.get(String(plan._id))?.customerApprovalRequired,
            ),
            bySubdivisions: Boolean(
              attachments.get(String(plan._id))?.subdivisionApprovalRequired,
            ),
            approver: attachments.get(String(plan._id))?.approver || null,
          },
          zone,
          worksCount: planWorks.length,
          workIds: planWorks.map((work) => work._id),
          overtimeWorkIds: priced.overtimeWorkIds,
          workingTimeMinutes: priced.workingTimeMinutes,
          overtimeMinutes: priced.overtimeMinutes,
          price: priced.price,
          additionalPrice: priced.additionalPrice,
          total: priced.total,
          // Работы вне услуг блокируют формирование отчёта — считаем на месяц,
          // а показываем в строке компании и на карточке подбора
          unrelatedWorksCount: unrelated.length,
          unrelatedWorkIds: unrelated.map((work) => work._id),
        });
      }
    }
  }

  rows.sort(
    (left, right) =>
      left.month.localeCompare(right.month) ||
      String(left.company.alias).localeCompare(String(right.company.alias), "ru"),
  );

  return rows;
};

module.exports = {
  MS_PER_MINUTE,
  DAYS_OF_WEEK,
  roundUp,
  isZeroLength,
  dayWindow,
  calcSingleWorkOvertime,
  calcOvertime,
  calcWorkTime,
  overallRoundedWorktimeMs,
  normalizePlan,
  priceHourPackage,
  resolveSchedule,
  companyZone,
  priceWorks,
  buildPreview,
};
