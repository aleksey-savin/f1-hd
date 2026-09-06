const mongoose = require("mongoose");

const dayjs = require("dayjs");
const dayjsUtc = require("dayjs/plugin/utc");
const dayjsTimezone = require("dayjs/plugin/timezone");
dayjs.extend(dayjsUtc);
dayjs.extend(dayjsTimezone);

const Company = require("@/models/company");
const Subdivision = require("@/models/subdivision");
const TicketCategory = require("@/models/ticketCategory");

const { AppError } = require("@/middleware/errorHandling");
const { resolveTimezone } = require("@/utils/datetime");

const {
  classifyWork,
  countUniqueTickets,
  groupBy,
  groupByCompany,
  loadWorks,
  periodKeyFn,
  summarize,
  workDurationMs,
} = require("@/services/workSummary");
const { buildSubdivisionIndex } = require("@/services/subdivisionTree");
const {
  buildSubdivisionAttribution,
  UNASSIGNED,
} = require("@/services/workSubdivision");

/**
 * Отчёт «Компании» (бывшая «Аналитика») — сводка по всем, карточка компании,
 * карточка подразделения и динамика.
 *
 * Границы периода — по настенным часам бизнес-таймзоны (docs/datetime-conventions).
 * Прежняя сводка резала период UTC-полуночью, а тренды — бизнес-зоной: цифры
 * одного отчёта считались по двум разным календарям и на стыках месяцев не
 * сходились. Теперь границы одни на все четыре эндпоинта, иначе карточка
 * компании не сойдётся со строкой сводки.
 */

// Год с небольшим: без ограничения `from=2015-01-01` вытягивал всю коллекцию
// работ. Тот же лимит у отчётов «Сотрудники» и персонального.
const MAX_PERIOD_DAYS = 366;

// Поля заявки, нужные разрезам: номер — для «самой ранней заявки» в атрибуции,
// заявитель — цепочка до подразделения, категория — разрез по категориям
const TICKET_SELECT = "num applicantId applicant categoryId";

const idOf = (value) => (value ? (value._id ?? value).toString() : null);
const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const emptyTotals = () => ({
  totalTickets: 0,
  totalWorks: 0,
  totalTime: 0,
  onSite: { count: 0, time: 0 },
  remote: { count: 0, time: 0 },
  routineTask: { count: 0, time: 0 },
});

/** Границы периода из yyyy-MM-dd по бизнес-зоне; конец — включительный. */
const resolvePeriod = ({ from, to, tz }) => {
  const start = dayjs.tz(from, tz).startOf("day");
  const end = dayjs.tz(to, tz).endOf("day");

  if (!start.isValid() || !end.isValid() || !end.isAfter(start)) {
    throw new AppError("Invalid report period", 400, true);
  }

  const days = end.diff(start, "day") + 1;
  if (days > MAX_PERIOD_DAYS) {
    throw new AppError(
      `Период отчёта не может превышать ${MAX_PERIOD_DAYS} дней`,
      400,
      true,
    );
  }

  return { from, to, days, tz, start, end };
};

/**
 * Предыдущий период той же длины. Сдвиг календарными сутками (dayjs.tz), а не
 * арифметикой на миллисекундах: на переходе летнего времени сутки не 24 часа.
 */
const prevPeriodOf = (period) => {
  const end = period.start.subtract(1, "day").endOf("day");
  const start = end.startOf("day").subtract(period.days - 1, "day");
  return {
    from: start.format("YYYY-MM-DD"),
    to: end.format("YYYY-MM-DD"),
    days: period.days,
    tz: period.tz,
    start,
    end,
  };
};

const serializePeriod = (period) => ({
  from: period.from,
  to: period.to,
  days: period.days,
  timezone: period.tz,
});

const loadPeriodWorks = ({ period, companyIds, withTickets = true, needsTicketFields }) =>
  loadWorks({
    from: period.start.toDate(),
    to: period.end.toDate(),
    endExclusive: false,
    companyIds: companyIds ? companyIds.map(toObjectId) : null,
    withTickets,
    ticketSelect: needsTicketFields ? TICKET_SELECT : "",
  });

/**
 * Работы, видимые запрашивающему. При полном доступе — все; при доступе
 * руководителя подразделения — только работы его подразделений (атрибуция по
 * заявителю, services/workSubdivision).
 */
const applyScope = async (works, scope) => {
  if (!scope.needsAttribution) {
    return { works, attribution: null };
  }

  const attribution = await buildSubdivisionAttribution(works, scope.subdivisionsById);
  const kept = works.filter((work) =>
    scope.allowsWork(
      idOf(work.company),
      attribution.subdivisionOfWork.get(work._id.toString()),
    ),
  );

  return { works: kept, attribution };
};

/**
 * Уникальные заявки набора с учётом ограничения по подразделениям: заявка
 * считается по СВОЕМУ подразделению, поэтому сумма по подразделениям равна
 * числу уникальных заявок компании.
 */
const countTickets = (works, { allowed, subdivisionOfTicket } = {}) => {
  if (!allowed || !subdivisionOfTicket) {
    return countUniqueTickets(works);
  }
  const ids = new Set();
  for (const work of works) {
    for (const ticket of work.tickets || []) {
      const ticketId = idOf(ticket);
      if (ticketId && allowed.has(subdivisionOfTicket.get(ticketId))) {
        ids.add(ticketId);
      }
    }
  }
  return ids.size;
};

const totalsOf = (works, options) => ({
  totalTickets: countTickets(works, options),
  ...summarize(works),
});

/** Разрез по категориям заявок: категория работы — по первой её заявке. */
const buildCategoryBreakdown = async (works) => {
  const categoryIds = new Set();
  for (const work of works) {
    const categoryId = idOf(work.tickets?.[0]?.categoryId);
    if (categoryId) {
      categoryIds.add(categoryId);
    }
  }

  const categories = categoryIds.size
    ? await TicketCategory.find({ _id: { $in: [...categoryIds] } })
        .select("title")
        .lean()
    : [];
  const titleById = new Map(
    categories.map((category) => [category._id.toString(), category.title]),
  );

  const buckets = new Map();
  let totalTime = 0;

  for (const work of works) {
    const categoryId = idOf(work.tickets?.[0]?.categoryId);
    const key = categoryId || "none";
    if (!buckets.has(key)) {
      buckets.set(key, {
        _id: categoryId,
        title: categoryId
          ? titleById.get(categoryId) || "Категория удалена"
          : "Без категории",
        time: 0,
        worksCount: 0,
      });
    }
    const bucket = buckets.get(key);
    const duration = workDurationMs(work);
    bucket.time += duration;
    bucket.worksCount += 1;
    totalTime += duration;
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      sharePercent: totalTime ? Math.round((bucket.time / totalTime) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.time - a.time);
};

/** Кто из наших обслуживал: разрез по исполнителям работ. */
const buildExecutorBreakdown = (works) => {
  const buckets = new Map();

  for (const work of works) {
    const executorId = idOf(work.finishedBy?._id);
    if (!executorId) {
      continue;
    }
    if (!buckets.has(executorId)) {
      buckets.set(executorId, {
        _id: executorId,
        name: `${work.finishedBy.lastName || ""} ${work.finishedBy.firstName || ""}`.trim(),
        time: 0,
        worksCount: 0,
        onSiteCount: 0,
      });
    }
    const bucket = buckets.get(executorId);
    bucket.time += workDurationMs(work);
    bucket.worksCount += 1;
    if (classifyWork(work) === "onSite") {
      bucket.onSiteCount += 1;
    }
  }

  return [...buckets.values()].sort((a, b) => b.time - a.time);
};

/** Помесячная динамика (12 бакетов, заканчивая месяцем конца периода). */
const buildMonthlySeries = async ({ period, companyId, scope, months = 12 }) => {
  const lastMonth = period.end.startOf("month");
  const firstMonth = lastMonth.subtract(months - 1, "month");

  const works = await loadWorks({
    from: firstMonth.startOf("month").toDate(),
    to: lastMonth.endOf("month").toDate(),
    endExclusive: false,
    companyIds: [toObjectId(companyId)],
    withTickets: true,
    ticketSelect: scope.needsAttribution ? TICKET_SELECT : "",
  });

  const { works: visible } = await applyScope(works, scope);

  const buckets = new Map();
  for (let cursor = firstMonth; cursor.valueOf() <= lastMonth.valueOf(); cursor = cursor.add(1, "month")) {
    buckets.set(cursor.format("YYYY-MM"), {
      month: cursor.format("YYYY-MM"),
      label: cursor.toDate().toLocaleDateString("ru-RU", {
        timeZone: period.tz,
        year: "numeric",
        month: "long",
      }),
      totalTime: 0,
      totalWorks: 0,
    });
  }

  for (const work of visible) {
    const key = dayjs(work.finishedAt).tz(period.tz).format("YYYY-MM");
    const bucket = buckets.get(key);
    if (!bucket) {
      continue;
    }
    bucket.totalTime += workDurationMs(work);
    bucket.totalWorks += 1;
  }

  return [...buckets.values()];
};

// ─────────────────────────────────────────────────────────────── сводка

const buildCompaniesSummary = async ({ from, to, scope, preferences }) => {
  const tz = resolveTimezone(preferences);
  const period = resolvePeriod({ from, to, tz });
  const prev = prevPeriodOf(period);

  if (scope.kind === "none") {
    return {
      period: serializePeriod(period),
      totals: { ...emptyTotals(), companiesWithData: 0 },
      prev: { period: serializePeriod(prev), totals: emptyTotals() },
      companies: [],
    };
  }

  const companyIds = scope.kind === "all" ? null : scope.companyIds;
  const companyFilter = companyIds ? { _id: { $in: companyIds.map(toObjectId) } } : {};

  const [companies, rawPeriodWorks, rawPrevWorks] = await Promise.all([
    Company.find(companyFilter)
      .select("alias fullTitle profileImagePath subdivisions")
      .sort({ alias: 1 })
      .lean(),
    loadPeriodWorks({ period, companyIds, needsTicketFields: scope.needsAttribution }),
    loadPeriodWorks({ period: prev, companyIds, needsTicketFields: scope.needsAttribution }),
  ]);

  const [{ works: periodWorks, attribution }, { works: prevWorks }] = await Promise.all([
    applyScope(rawPeriodWorks, scope),
    applyScope(rawPrevWorks, scope),
  ]);

  const worksByCompany = groupByCompany(periodWorks);
  const rows = [];

  for (const company of companies) {
    const companyId = company._id.toString();
    const works = worksByCompany.get(companyId) || [];
    const access = scope.companyAccess(companyId);

    // При полном доступе компанию без работ не показываем (список бы распух на
    // весь справочник); при суженном — показываем всегда, иначе руководитель
    // подразделения в пустой месяц видит просто белый экран
    if (works.length === 0 && scope.kind === "all") {
      continue;
    }

    const allowed = scope.allowedSubdivisionIds(companyId);
    const summary = totalsOf(works, {
      allowed,
      subdivisionOfTicket: attribution?.subdivisionOfTicket,
    });

    rows.push({
      company: {
        _id: company._id,
        alias: company.alias,
        fullTitle: company.fullTitle,
        profileImagePath: company.profileImagePath || null,
      },
      ...summary,
      access,
      hasSubdivisions: (company.subdivisions || []).length > 0,
      scopeLimited: access === "partial",
    });
  }

  const totals = rows.reduce((acc, row) => {
    acc.totalTickets += row.totalTickets;
    acc.totalWorks += row.totalWorks;
    acc.totalTime += row.totalTime;
    for (const key of ["onSite", "remote", "routineTask"]) {
      acc[key].count += row[key].count;
      acc[key].time += row[key].time;
    }
    return acc;
  }, emptyTotals());

  return {
    period: serializePeriod(period),
    totals: {
      ...totals,
      companiesWithData: rows.filter((row) => row.totalWorks > 0).length,
    },
    prev: {
      period: serializePeriod(prev),
      totals: totalsOf(prevWorks),
    },
    companies: rows,
  };
};

// ────────────────────────────────────────────────────── карточка компании

/** Компания + проверка доступа; 404 отдельно от 403. */
const loadCompanyForScope = async (companyId, scope) => {
  const company = await Company.findById(companyId)
    .select("alias fullTitle profileImagePath timezone subdivisions")
    .lean();
  if (!company) {
    throw new AppError(`Company ${companyId} not found`, 404, true);
  }
  if (!scope.companyAccess(company._id.toString())) {
    throw new AppError("Отчёт по этой компании недоступен", 403, true);
  }
  return company;
};

/**
 * Раскладка работ по подразделениям: у узла считаются собственные показатели,
 * поддерево суммируется отдельно. Работы, чьё подразделение не определилось,
 * попадают в «Без подразделения» — их нельзя терять, иначе сумма по
 * подразделениям перестанет сходиться с итогом компании.
 */
const buildSubdivisionBreakdown = ({ works, attribution, index, allowed }) => {
  const ownWorks = new Map();
  const ownTickets = new Map();

  const bucketOf = (map, key, factory) => {
    if (!map.has(key)) {
      map.set(key, factory());
    }
    return map.get(key);
  };

  for (const work of works) {
    const key = attribution.subdivisionOfWork.get(work._id.toString()) || UNASSIGNED;
    bucketOf(ownWorks, key, () => []).push(work);

    for (const ticket of work.tickets || []) {
      const ticketId = idOf(ticket);
      if (!ticketId) {
        continue;
      }
      const ticketKey = attribution.subdivisionOfTicket.get(ticketId) || UNASSIGNED;
      bucketOf(ownTickets, ticketKey, () => new Set()).add(ticketId);
    }
  }

  const statsOf = (key) => {
    const bucket = ownWorks.get(key) || [];
    return {
      totalTickets: (ownTickets.get(key) || new Set()).size,
      ...summarize(bucket),
    };
  };

  const nodes = [];
  for (const [id, doc] of index.byId) {
    if (allowed && !allowed.has(id)) {
      continue;
    }
    const own = statsOf(id);
    const subtreeIds = index.descendantsOf(id).filter((child) => !allowed || allowed.has(child));
    const subtree = subtreeIds.reduce(
      (acc, child) => {
        const stats = statsOf(child);
        acc.totalTickets += stats.totalTickets;
        acc.totalWorks += stats.totalWorks;
        acc.totalTime += stats.totalTime;
        return acc;
      },
      { totalTickets: 0, totalWorks: 0, totalTime: 0 },
    );

    if (subtree.totalWorks === 0 && subtree.totalTickets === 0) {
      continue;
    }

    nodes.push({
      _id: doc._id,
      name: doc.name,
      parentId: doc.parent || null,
      depth: index.depthOf(id),
      path: index.pathOf(id),
      ...own,
      subtree,
    });
  }

  nodes.sort((a, b) => b.subtree.totalTime - a.subtree.totalTime);

  return {
    nodes,
    unassigned: statsOf(UNASSIGNED),
    statsOf,
  };
};

const buildCompanyCard = async ({ companyId, from, to, scope, preferences }) => {
  const tz = resolveTimezone(preferences);
  const period = resolvePeriod({ from, to, tz });
  const prev = prevPeriodOf(period);

  const company = await loadCompanyForScope(companyId, scope);
  const access = scope.companyAccess(companyId);
  const allowed = scope.allowedSubdivisionIds(companyId);

  const [subdivisionDocs, rawWorks, rawPrevWorks] = await Promise.all([
    Subdivision.find({ company: company._id }).select("name parent company").lean(),
    loadPeriodWorks({ period, companyIds: [companyId], needsTicketFields: true }),
    loadPeriodWorks({ period: prev, companyIds: [companyId], needsTicketFields: true }),
  ]);

  const index = buildSubdivisionIndex(subdivisionDocs);
  const attribution = await buildSubdivisionAttribution(rawWorks, index.byId);

  const works = allowed
    ? rawWorks.filter((work) =>
        allowed.has(attribution.subdivisionOfWork.get(work._id.toString())),
      )
    : rawWorks;

  const breakdown = buildSubdivisionBreakdown({ works, attribution, index, allowed });

  const [byCategory, byMonth, prevAttribution] = await Promise.all([
    buildCategoryBreakdown(works),
    buildMonthlySeries({ period, companyId, scope }),
    allowed
      ? buildSubdivisionAttribution(rawPrevWorks, index.byId)
      : Promise.resolve(null),
  ]);

  const prevWorks = allowed
    ? rawPrevWorks.filter((work) =>
        allowed.has(prevAttribution.subdivisionOfWork.get(work._id.toString())),
      )
    : rawPrevWorks;

  return {
    period: serializePeriod(period),
    access,
    scopeLimited: access === "partial",
    company: {
      _id: company._id,
      alias: company.alias,
      fullTitle: company.fullTitle,
      profileImagePath: company.profileImagePath || null,
      timezone: company.timezone || null,
      subdivisionsCount: subdivisionDocs.length,
    },
    totals: totalsOf(works, {
      allowed,
      subdivisionOfTicket: attribution.subdivisionOfTicket,
    }),
    prev: {
      period: serializePeriod(prev),
      totals: totalsOf(prevWorks, {
        allowed,
        subdivisionOfTicket: prevAttribution?.subdivisionOfTicket,
      }),
    },
    subdivisions: breakdown.nodes,
    // При суженном доступе «Без подразделения» не показываем: чужие работы в
    // этот бакет не попадают, а объяснить пустую строку нечем
    unassigned: allowed ? null : breakdown.unassigned,
    byCategory,
    executors: buildExecutorBreakdown(works),
    byMonth,
    diagnostics: attribution.diagnostics,
  };
};

// ─────────────────────────────────────────────── карточка подразделения

const buildSubdivisionCard = async ({
  companyId,
  subdivisionId,
  from,
  to,
  includeDescendants = true,
  scope,
  preferences,
}) => {
  const tz = resolveTimezone(preferences);
  const period = resolvePeriod({ from, to, tz });
  const prev = prevPeriodOf(period);

  const company = await loadCompanyForScope(companyId, scope);

  const subdivisionDocs = await Subdivision.find({ company: company._id })
    .select("name parent company manager timezone users")
    .populate({ path: "manager", select: "firstName lastName position" })
    .lean();
  const index = buildSubdivisionIndex(subdivisionDocs);

  const node = index.byId.get(String(subdivisionId));
  if (!node) {
    // Подразделение существует, но у другой компании — битая ссылка, не отказ
    throw new AppError(`Subdivision ${subdivisionId} not found`, 404, true);
  }

  const allowed = scope.allowedSubdivisionIds(companyId);
  if (allowed && !allowed.has(String(subdivisionId))) {
    throw new AppError("Отчёт по этому подразделению недоступен", 403, true);
  }

  const [rawWorks, rawPrevWorks] = await Promise.all([
    loadPeriodWorks({ period, companyIds: [companyId], needsTicketFields: true }),
    loadPeriodWorks({ period: prev, companyIds: [companyId], needsTicketFields: true }),
  ]);

  const [attribution, prevAttribution] = await Promise.all([
    buildSubdivisionAttribution(rawWorks, index.byId),
    buildSubdivisionAttribution(rawPrevWorks, index.byId),
  ]);

  const scopeIds = new Set(
    includeDescendants
      ? index.descendantsOf(String(subdivisionId))
      : [String(subdivisionId)],
  );
  const visibleIds = allowed
    ? new Set([...scopeIds].filter((id) => allowed.has(id)))
    : scopeIds;

  const worksIn = (source, map) =>
    source.filter((work) => visibleIds.has(map.subdivisionOfWork.get(work._id.toString())));

  const works = worksIn(rawWorks, attribution);
  const prevWorks = worksIn(rawPrevWorks, prevAttribution);
  const selfWorks = rawWorks.filter(
    (work) => attribution.subdivisionOfWork.get(work._id.toString()) === String(subdivisionId),
  );

  const breakdown = buildSubdivisionBreakdown({
    works,
    attribution,
    index,
    allowed: visibleIds,
  });

  // Прямые дети узла — строками таблицы
  const childIds = index.childrenOf.get(String(subdivisionId)) || [];
  const children = childIds
    .filter((childId) => visibleIds.has(childId))
    .map((childId) => {
      const child = breakdown.nodes.find((item) => item._id.toString() === childId);
      const doc = index.byId.get(childId);
      return (
        child || {
          _id: doc._id,
          name: doc.name,
          parentId: doc.parent || null,
          depth: index.depthOf(childId),
          path: index.pathOf(childId),
          ...emptyTotals(),
          subtree: { totalTickets: 0, totalWorks: 0, totalTime: 0 },
        }
      );
    })
    .sort((a, b) => b.subtree.totalTime - a.subtree.totalTime);

  // Кто обращался: заявители со стороны клиента, а не наши исполнители
  const applicantBuckets = new Map();
  for (const work of works) {
    for (const ticket of work.tickets || []) {
      const ticketId = idOf(ticket);
      const ticketSubdivision = attribution.subdivisionOfTicket.get(ticketId);
      if (!ticketId || !visibleIds.has(ticketSubdivision)) {
        continue;
      }
      const applicantId =
        idOf(ticket.applicantId) || idOf(ticket.applicant?._id) || null;
      const key = applicantId || "unknown";
      if (!applicantBuckets.has(key)) {
        const applicant = applicantId
          ? attribution.applicantsById.get(applicantId)
          : null;
        applicantBuckets.set(key, {
          _id: applicantId,
          lastName: applicant?.lastName || ticket.applicant?.lastName || "",
          firstName: applicant?.firstName || ticket.applicant?.firstName || "",
          ticketIds: new Set(),
        });
      }
      applicantBuckets.get(key).ticketIds.add(ticketId);
    }
  }

  const byApplicant = [...applicantBuckets.values()]
    .map(({ ticketIds, ...applicant }) => ({
      ...applicant,
      ticketsCount: ticketIds.size,
    }))
    .sort((a, b) => b.ticketsCount - a.ticketsCount);

  const byMonthAll = await buildMonthlySeries({ period, companyId, scope });

  return {
    period: serializePeriod(period),
    includeDescendants,
    access: scope.companyAccess(companyId),
    company: {
      _id: company._id,
      alias: company.alias,
      fullTitle: company.fullTitle,
      profileImagePath: company.profileImagePath || null,
    },
    subdivision: {
      _id: node._id,
      name: node.name,
      parentId: node.parent || null,
      path: index.pathOf(String(subdivisionId)),
      manager: node.manager
        ? {
            _id: node.manager._id,
            firstName: node.manager.firstName,
            lastName: node.manager.lastName,
            position: node.manager.position || null,
          }
        : null,
      usersCount: (node.users || []).length,
      timezone: node.timezone || null,
      childrenCount: childIds.length,
    },
    totals: totalsOf(works, {
      allowed: visibleIds,
      subdivisionOfTicket: attribution.subdivisionOfTicket,
    }),
    self: totalsOf(selfWorks, {
      allowed: new Set([String(subdivisionId)]),
      subdivisionOfTicket: attribution.subdivisionOfTicket,
    }),
    prev: {
      period: serializePeriod(prev),
      totals: totalsOf(prevWorks, {
        allowed: visibleIds,
        subdivisionOfTicket: prevAttribution.subdivisionOfTicket,
      }),
    },
    children,
    byCategory: await buildCategoryBreakdown(works),
    byApplicant,
    byMonth: byMonthAll,
    diagnostics: attribution.diagnostics,
  };
};

// ─────────────────────────────────────────────────────────────── динамика

/**
 * Нарезка периодов. Границы и подписи — по настенным часам бизнес-зоны
 * (перенесено из controllers/report.js без изменений семантики).
 */
const generatePeriods = (startDate, endDate, grouping, tz) => {
  const periods = [];
  const rangeStart = dayjs.tz(startDate, tz);
  const rangeEnd = dayjs.tz(endDate, tz);

  const clampEnd = (periodEnd) =>
    periodEnd.isAfter(rangeEnd) ? rangeEnd.toDate() : periodEnd.toDate();
  const labelDate = (instant, options) =>
    instant.toLocaleDateString("ru-RU", { timeZone: tz, ...options });

  if (grouping === "month") {
    let cursor = rangeStart.startOf("month");
    while (cursor.toDate() < endDate) {
      periods.push({
        start: cursor.toDate(),
        end: clampEnd(cursor.endOf("month")),
        label: labelDate(cursor.toDate(), { year: "numeric", month: "long" }),
        key: cursor.format("YYYY-MM-DD"),
      });
      cursor = cursor.add(1, "month").startOf("month");
    }
  } else if (grouping === "quarter") {
    const startYear = rangeStart.year();
    const endYear = rangeEnd.year();
    const startQuarter = Math.floor(rangeStart.month() / 3);

    for (let year = startYear; year <= endYear; year++) {
      const firstQuarter = year === startYear ? startQuarter : 0;
      const lastQuarter = year === endYear ? Math.floor(rangeEnd.month() / 3) : 3;

      for (let quarter = firstQuarter; quarter <= lastQuarter; quarter++) {
        const periodStart = rangeStart.year(year).month(quarter * 3).startOf("month");
        const periodEnd = periodStart.add(2, "month").endOf("month");

        if (periodStart.toDate() > endDate || periodEnd.toDate() < startDate) {
          continue;
        }

        periods.push({
          start:
            periodStart.toDate() < startDate ? new Date(startDate) : periodStart.toDate(),
          end: clampEnd(periodEnd),
          label: `${quarter + 1} квартал ${year}`,
          key: periodStart.format("YYYY-MM-DD"),
        });
      }
    }
  } else if (grouping === "week") {
    let cursor = rangeStart.startOf("day");

    while (cursor.toDate() < endDate) {
      const periodEndClamped = clampEnd(cursor.add(6, "day").endOf("day"));
      const weekStart = labelDate(cursor.toDate(), { day: "2-digit", month: "2-digit" });
      const weekEnd = labelDate(periodEndClamped, { day: "2-digit", month: "2-digit" });

      periods.push({
        start: cursor.toDate(),
        end: periodEndClamped,
        label: `${weekStart} - ${weekEnd}`,
        key: cursor.format("YYYY-MM-DD"),
      });

      cursor = cursor.add(7, "day").startOf("day");
    }
  }

  return periods;
};

const buildCompaniesTrends = async ({
  period: presetName,
  grouping = "month",
  startDate: customStartDate,
  endDate: customEndDate,
  scope,
  preferences,
}) => {
  const tz = resolveTimezone(preferences);
  const now = dayjs.tz(new Date(), tz);

  let startDate;
  let endDate;
  if (presetName === "12months") {
    endDate = now.endOf("day").toDate();
    startDate = now.subtract(12, "month").startOf("day").toDate();
  } else if (presetName === "currentYear") {
    startDate = now.startOf("year").toDate();
    endDate = now.endOf("year").toDate();
  } else if (presetName === "lastYear") {
    const lastYear = now.subtract(1, "year");
    startDate = lastYear.startOf("year").toDate();
    endDate = lastYear.endOf("year").toDate();
  } else if (presetName === "custom" && customStartDate && customEndDate) {
    startDate = dayjs.tz(customStartDate, tz).startOf("day").toDate();
    endDate = dayjs.tz(customEndDate, tz).endOf("day").toDate();
  } else {
    throw new AppError("Invalid trends period", 400, true);
  }

  if (scope.kind === "none") {
    return {
      data: [],
      overall: [],
      meta: { period: presetName, grouping, startDate, endDate, periodsCount: 0 },
    };
  }

  const companyIds = scope.kind === "all" ? null : scope.companyIds;
  const companies = await Company.find(
    companyIds ? { _id: { $in: companyIds.map(toObjectId) } } : {},
  )
    .select("alias fullTitle profileImagePath")
    .sort({ alias: 1 })
    .lean();

  const periods = generatePeriods(startDate, endDate, grouping, tz);

  const rawWorks = periods.length
    ? await loadWorks({
        from: periods[0].start,
        to: periods[periods.length - 1].end,
        endExclusive: false,
        companyIds: companyIds ? companyIds.map(toObjectId) : null,
        ticketSelect: scope.needsAttribution ? TICKET_SELECT : "",
      })
    : [];

  const { works } = await applyScope(rawWorks, scope);
  const worksByCompany = groupByCompany(works);
  const keyOf = periodKeyFn(periods);

  const data = [];
  for (const company of companies) {
    const companyWorks = worksByCompany.get(company._id.toString()) || [];
    if (companyWorks.length === 0) {
      continue;
    }
    const worksByPeriod = groupBy(companyWorks, keyOf);
    data.push({
      company: {
        _id: company._id,
        alias: company.alias,
        fullTitle: company.fullTitle,
        profileImagePath: company.profileImagePath || null,
      },
      periods: periods.map((item) => ({
        ...item,
        ...totalsOf(worksByPeriod.get(item.key) || []),
      })),
    });
  }

  // Итоги по всем компаниям — считает сервер: фронт иначе складывал бы уникальные
  // заявки компаний и получал бы своё число
  const worksByPeriodAll = groupBy(works, keyOf);
  const overall = periods.map((item) => ({
    ...item,
    ...totalsOf(worksByPeriodAll.get(item.key) || []),
  }));

  return {
    data,
    overall,
    meta: {
      period: presetName,
      grouping,
      startDate,
      endDate,
      periodsCount: periods.length,
    },
  };
};

module.exports = {
  buildCompaniesSummary,
  buildCompanyCard,
  buildSubdivisionCard,
  buildCompaniesTrends,
  generatePeriods,
  MAX_PERIOD_DAYS,
};
