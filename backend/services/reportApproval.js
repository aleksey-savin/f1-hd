const crypto = require("crypto");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const Company = require("@/models/company");
const Preferences = require("@/models/preferences");
const ServicePlan = require("@/models/finances/servicePlan");
const ServicePlanReport = require("@/models/finances/servicePlanReport");
const Subdivision = require("@/models/subdivision");
const TicketCategory = require("@/models/ticketCategory");
const User = require("@/models/user");
const Work = require("@/models/work");

const { AppError } = require("@/middleware/errorHandling");
const { buildCalendarContext } = require("@/services/productionCalendar");
const { buildSubdivisionIndex } = require("@/services/subdivisionTree");
const {
  buildSubdivisionAttribution,
  UNASSIGNED,
} = require("@/services/workSubdivision");
const {
  calcOvertime,
  calcWorkTime,
  companyZone,
  normalizePlan,
  priceWorks,
  resolveSchedule,
} = require("@/services/servicePlanBilling");
const {
  notifyApprovalRequested,
  notifyAutoApproved,
  notifyDecision,
} = require("@/services/reportApprovalNotifications");
const { resolveTimezone } = require("@/utils/datetime");
const { permissionFilter } = require("@/services/permissions");

/**
 * Жизненный цикл отчёта по услуге: формирование → согласование клиентом →
 * счёт → оплата → архив.
 *
 * Раньше маршрут обрывался на первом же шаге: при включённом
 * `customerApprovalRequired` отчёт уходил в `pendingApproval`, а выхода из
 * этого статуса не существовало — ни эндпоинта, ни экрана, ни срока. Здесь
 * инвариант обратный: **у отчёта всегда есть легальный следующий шаг**.
 *
 * Правила переходов (сервер, не интерфейс — на «кнопку не покажем» полагаться
 * нельзя):
 *  - решение принимает только тот, чья подпись сейчас ожидается
 *    (services/reportApprovalScope);
 *  - отказ части возвращает отчёт нам, НЕ трогая подписи остальных частей:
 *    повторно беспокоить подписавших руководителей нечестно;
 *  - на время правки срок автосогласования снимается (deadlineAt = null) —
 *    договорный срок не должен съедаться нашей же задержкой;
 *  - повторная отправка увеличивает `attempt`, сбрасывает в `pending` только
 *    отклонённые части и заводит срок заново.
 */

const MS_PER_MINUTE = 60 * 1000;
const NON_WORKING_KINDS = new Set(["holiday", "dayoff", "weekend"]);

const idOf = (value) => (value ? String(value._id ?? value) : null);

const actorOf = (user) =>
  user
    ? {
        _id: user._id || user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
      }
    : null;

/**
 * Срок согласования: N дней от отправки, конец дня в бизнес-таймзоне.
 * `workdaysOnly` считает по производственному календарю — «5 дней по договору»
 * у части клиентов означает рабочие дни.
 */
const computeDeadline = async (from, preferences, zone) => {
  const settings = preferences?.reportApproval?.autoApprove;
  if (!settings?.isActive) {
    return null;
  }

  const days = Math.max(1, settings.days || 5);
  const start = dayjs(from).tz(zone);

  if (!settings.workdaysOnly) {
    return start.add(days, "day").endOf("day").toDate();
  }

  // Рабочие дни: шагаем по календарю, пропуская выходные и праздники
  const horizon = start.add(days * 3 + 14, "day");
  const calendar = await buildCalendarContext(
    start.format("YYYY-MM-DD"),
    horizon.format("YYYY-MM-DD"),
    preferences,
  );

  let cursor = start;
  let left = days;
  let guard = 0;
  while (left > 0 && guard < 400) {
    guard += 1;
    cursor = cursor.add(1, "day");
    const { kind } = calendar.classify(cursor.format("YYYY-MM-DD")) || {};
    if (!NON_WORKING_KINDS.has(kind)) {
      left -= 1;
    }
  }

  return cursor.endOf("day").toDate();
};

/**
 * Персональные ссылки для тех, чьей подписи ждём.
 *
 * Токен на адресата, а не на отчёт: подпись обязана иметь имя. Общая ссылка
 * дала бы в истории «согласовано по ссылке» без человека — и её мог бы
 * переслать кто угодно кому угодно.
 */
const issueAccessTokens = (
  report,
  preferences,
  recipients,
  subdivisionOf,
  { reset = false } = {},
) => {
  const extraDays = preferences?.reportApproval?.linkExtraDays ?? 7;
  const base = report.approval?.deadlineAt || new Date();
  const expiresAt = dayjs(base).add(extraDays, "day").toDate();

  // Повторная отправка — новая попытка и новый состав: прежние ссылки обязаны
  // умереть, иначе по старой подписали бы уже не тот документ
  if (reset) {
    report.accessTokens = [];
  }

  // Ссылки выдаются волнами, по мере того как очередь доходит до уровня. Уже
  // выданную не перевыпускаем: письмо, отправленное час назад, должно работать
  const issued = new Set(
    (report.accessTokens || [])
      .filter((item) => !item.usedAt)
      .map((item) => String(item.user?._id)),
  );

  for (const user of recipients || []) {
    if (!user || issued.has(String(user._id))) {
      continue;
    }
    report.accessTokens.push({
      token: crypto.randomBytes(24).toString("base64url"),
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      subdivision: subdivisionOf?.get(String(user._id)) || null,
      expiresAt,
      usedAt: null,
    });
    issued.add(String(user._id));
  }
};

/** Ссылка конкретного адресата — для письма именно ему. */
const tokenFor = (report, userId) =>
  (report.accessTokens || []).find(
    (item) => String(item.user?._id) === String(userId) && !item.usedAt,
  )?.token || null;

/** Какому руководителю какая часть — чтобы ссылка вела на его подпись. */
const subdivisionByManager = async (report) => {
  const pending = (report.parts || []).filter(
    (part) => part.status === "pending" && part.subdivision,
  );
  if (pending.length === 0) {
    return new Map();
  }
  const nodes = await Subdivision.find({
    _id: { $in: pending.map((part) => part.subdivision) },
  })
    .select("manager")
    .lean();
  return new Map(
    nodes
      .filter((node) => node.manager)
      .map((node) => [String(node.manager), node._id]),
  );
};

const pushEvent = (report, event) => {
  report.timeline.push({ at: new Date(), ...event });
};

/**
 * Деление отчёта на части по подразделениям клиента.
 *
 * Атрибуция — общая с отчётами (services/workSubdivision): работа относится к
 * подразделению заявителя самой ранней заявки. Деньги: доп. оплата считается
 * по каждой части точно (переработка аддитивна), основная цена делится
 * пропорционально времени — у пакета и фиксированной цены слагаемых просто нет.
 * Остаток от округления забирает последняя часть, чтобы Σ частей была равна
 * итогу отчёта до копейки.
 */
const buildParts = async ({ works, plan, company, zone, categoryById, priced }) => {
  const subdivisions = await Subdivision.find({ company: company._id })
    .select("name parent company manager")
    .lean();
  const index = buildSubdivisionIndex(subdivisions);
  const { subdivisionOfWork } = await buildSubdivisionAttribution(
    works,
    index.byId,
  );

  const buckets = new Map();
  for (const work of works) {
    const key = subdivisionOfWork.get(String(work._id)) || UNASSIGNED;
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(work);
  }

  const tariff = normalizePlan(plan);
  const schedule = resolveSchedule(plan, company);

  const drafts = [];
  let minutesTotal = 0;

  for (const [key, bucketWorks] of buckets) {
    const minutes =
      tariff.type === "hourly"
        ? bucketWorks.reduce(
            (sum, work) =>
              sum +
              Math.max(
                0,
                new Date(work.finishedAt) - new Date(work.startedAt),
              ) /
                MS_PER_MINUTE,
            0,
          )
        : calcWorkTime(schedule, bucketWorks, tariff.tariffingPeriod, zone)
            .roundedWorktime;

    const billableForOvertime = bucketWorks.filter((work) => {
      const category = categoryById.get(
        String(
          work.tickets?.[0]?.categoryId?._id ?? work.tickets?.[0]?.categoryId,
        ),
      );
      return !category?.alwaysWithinPlan;
    });

    const { overtime } =
      tariff.type === "hourly"
        ? { overtime: 0 }
        : calcOvertime(
            schedule,
            billableForOvertime,
            tariff.tariffingPeriod,
            zone,
          );

    minutesTotal += minutes;
    drafts.push({
      subdivision: key === UNASSIGNED ? null : key,
      subdivisionName:
        key === UNASSIGNED
          ? "Без подразделения"
          : index.byId.get(key)?.name || "Подразделение",
      works: bucketWorks.map((work) => work._id),
      minutes,
      additionalPrice: (overtime * tariff.pricePerHourNonWorking) / 60,
    });
  }

  // Основная цена — пропорционально времени; «Без подразделения» всегда
  // последним, оно же и забирает остаток округления
  drafts.sort((left, right) => {
    if (left.subdivision === null) return 1;
    if (right.subdivision === null) return -1;
    return String(left.subdivisionName).localeCompare(
      String(right.subdivisionName),
      "ru",
    );
  });

  let distributed = 0;
  return drafts.map((draft, position) => {
    const isLast = position === drafts.length - 1;
    const share =
      minutesTotal > 0 ? (priced.price * draft.minutes) / minutesTotal : 0;
    const price = isLast
      ? Math.round((priced.price - distributed) * 100) / 100
      : Math.round(share * 100) / 100;
    distributed += price;

    return {
      subdivision: draft.subdivision,
      subdivisionName: draft.subdivisionName,
      works: draft.works,
      price,
      additionalPrice: Math.round(draft.additionalPrice * 100) / 100,
      // Все части рождаются ждущими; очередь открывает advanceWaves — сначала
      // самым нижним подразделениям
      status: "waiting",
    };
  });
};

// Ограничитель обхода вверх по дереву: цикл в данных не должен вешать ответ
const MAX_CHAIN = 20;

/**
 * Дерево частей: кто кого ждёт.
 *
 * Согласование идёт снизу вверх — вышестоящее подразделение получает ссылку и
 * письмо, только когда подписаны ВСЕ его нижние части. Родителем здесь считается
 * БЛИЖАЙШИЙ предок, у которого часть тоже есть: уровни без работ цепочку не
 * удлиняют, подписывать им нечего (то же правило рисует дерево в маршруте
 * подписей на карточке).
 */
const buildPartTree = async (report) => {
  const parts = (report.parts || []).filter((part) => part.subdivision);
  const childrenOf = new Map(
    parts.map((part) => [String(part.subdivision), []]),
  );
  if (parts.length === 0) {
    return { childrenOf };
  }

  const docs = await Subdivision.find({
    company: report.company?._id || report.company,
  })
    .select("name parent company")
    .lean();
  const index = buildSubdivisionIndex(docs);

  for (const part of parts) {
    let current = index.byId.get(String(part.subdivision))?.parent;
    let guard = 0;
    while (current && guard < MAX_CHAIN) {
      const key = String(current);
      if (childrenOf.has(key)) {
        childrenOf.get(key).push(part);
        break;
      }
      current = index.byId.get(key)?.parent;
      guard += 1;
    }
  }

  return { childrenOf };
};

/**
 * Открыть очередь тем, чей черёд наступил, и вернуть их.
 *
 * Часть ждёт, пока не подписаны все её прямые потомки в дереве частей. У листа
 * потомков нет — он и есть «самое нижнее подразделение», его очередь первая.
 * За один проход открывается ровно один уровень: потомок, ставший `pending`,
 * ещё не `approved`, и его родителя не пропустит.
 */
const advanceWaves = (report, childrenOf) => {
  const opened = [];
  for (const part of report.parts || []) {
    if (!part.subdivision || part.status !== "waiting") {
      continue;
    }
    const children = childrenOf.get(String(part.subdivision)) || [];
    if (children.every((child) => child.status === "approved")) {
      part.status = "pending";
      opened.push(part);
    }
  }
  return opened;
};

/** Состав отчёта: работы из базы + справочники, нужные для расчёта. */
const loadContext = async ({ companyId, servicePlanId, workIds }) => {
  const [company, servicePlan, preferences, categories, works] =
    await Promise.all([
      Company.findById(companyId).lean(),
      ServicePlan.findById(servicePlanId).lean(),
      Preferences.findOne({}).lean(),
      TicketCategory.find({}).select("alwaysWithinPlan").lean(),
      Work.find({ _id: { $in: workIds } })
        .select("company startedAt finishedAt withinPlan tickets finances")
        .populate({ path: "tickets", select: "num categoryId applicantId" })
        .lean(),
    ]);

  if (!company) {
    throw new AppError(`Компания ${companyId} не найдена`, 404);
  }
  if (!servicePlan) {
    throw new AppError(`Услуга ${servicePlanId} не найдена`, 404);
  }
  if (works.length === 0) {
    throw new AppError("В отчёт не попало ни одной работы", 400);
  }

  return {
    company,
    servicePlan,
    preferences,
    works,
    zone: companyZone(company, resolveTimezone(preferences)),
    categoryById: new Map(
      categories.map((category) => [String(category._id), category]),
    ),
    attachment:
      (company.servicePlans || []).find(
        (item) => String(item._id) === String(servicePlanId),
      ) || {},
  };
};

/** Кому сейчас ждать подписи: руководители незакрытых частей либо финальный. */
/** Действующие руководители подразделений заданного набора частей. */
const managersOfParts = async (parts) => {
  const ids = (parts || []).map((part) => part.subdivision).filter(Boolean);
  if (ids.length === 0) {
    return [];
  }
  const nodes = await Subdivision.find({ _id: { $in: ids } })
    .select("manager")
    .lean();
  const managerIds = nodes.map((node) => node.manager).filter(Boolean);
  if (managerIds.length === 0) {
    return [];
  }
  return User.find({ _id: { $in: managerIds }, banned: { $ne: true } })
    .select("firstName lastName email telegramBot notify")
    .lean();
};

const pendingApprovers = async (report) => {
  // Только текущая волна: у кого очередь ещё не наступила (`waiting`), тот и
  // напоминаний получать не должен
  const pendingParts = (report.parts || []).filter(
    (part) => part.status === "pending" && part.subdivision,
  );

  if (report.approval?.bySubdivisions && pendingParts.length > 0) {
    return managersOfParts(pendingParts);
  }

  const finalId = idOf(report.approval?.finalApprover?._id);
  if (!finalId) {
    return [];
  }
  return User.find({ _id: finalId, banned: { $ne: true } })
    .select("firstName lastName email telegramBot notify")
    .lean();
};

/**
 * Маршрут подписей обязан быть проходимым.
 *
 * Инвариант раздела — «у отчёта всегда есть легальный следующий шаг». Если
 * согласующий не назначен или отключён, а у филиала нет живого руководителя,
 * отчёт ушёл бы в pendingApproval без единого подписанта: тот самый тупик,
 * ради устранения которого всё и затевалось. Поэтому проверяем ДО отправки и
 * отказываем словами — назвав, что именно чинить.
 */
const assertApprovalRoute = async (report, attachment) => {
  const problems = [];

  const finalId = idOf(attachment?.approver?._id);
  if (!finalId) {
    problems.push("не назначен согласующий со стороны клиента");
  } else {
    const approver = await User.findOne({ _id: finalId, banned: { $ne: true } })
      .select("_id")
      .lean();
    if (!approver) {
      const who = [attachment.approver.lastName, attachment.approver.firstName]
        .filter(Boolean)
        .join(" ");
      problems.push(`согласующий ${who || ""} отключён`.replace(/\s+/g, " "));
    }
  }

  if (report.approval?.bySubdivisions) {
    const named = (report.parts || []).filter((part) => part.subdivision);
    if (named.length === 0) {
      problems.push(
        "включено согласование по подразделениям, но ни одна работа не отнеслась к филиалу — у заявителей не заполнено подразделение",
      );
    } else {
      const nodes = await Subdivision.find({
        _id: { $in: named.map((part) => part.subdivision) },
      })
        .select("name manager")
        .lean();
      const managerIds = nodes.map((node) => node.manager).filter(Boolean);
      const active = await User.find({
        _id: { $in: managerIds },
        banned: { $ne: true },
      })
        .select("_id")
        .lean();
      const activeIds = new Set(active.map((user) => String(user._id)));
      const orphans = nodes.filter(
        (node) => !node.manager || !activeIds.has(String(node.manager)),
      );
      if (orphans.length > 0) {
        problems.push(
          `без действующего руководителя: ${orphans.map((node) => `«${node.name}»`).join(", ")}`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new AppError(
      `Отчёт некому согласовать — ${problems.join("; ")}. Поправьте настройки услуги в карточке компании и отправьте снова.`,
      400,
    );
  }
};

/** Наша сторона: тот, кто отправлял отчёт. */
/**
 * Наши, кому сообщать о решении клиента.
 *
 * Не только автор отчёта: пока он в отпуске или уволился, отказ клиента не
 * увидел бы никто, а на нём стоит вся дальнейшая работа — правка состава и
 * повторная отправка. Поэтому весь, кто ведёт отчёты, то есть держатели
 * `canSeeGlobalFinancialReport` (тем же правом открывается раздел, см.
 * services/reportApprovalScope) и администраторы.
 *
 * Автор добавляется отдельно и безусловно: право могли снять после того, как
 * он отправил отчёт, но узнать о судьбе своей отправки он всё равно должен.
 */
const contractorRecipients = async (report) =>
  User.find({
    banned: { $ne: true },
    isEndUser: { $ne: true },
    $or: [
      { _id: report.createdBy },
      ...(await permissionFilter("canSeeGlobalFinancialReport")).$or,
    ],
  })
    .select("firstName lastName email telegramBot notify")
    .lean();

/** Проставляет работам стадию биллинга и подпись стороны. */
const applyWorkStage = async (workIds, status, { contractor, customer } = {}) => {
  const update = { "finances.status": status };
  if (contractor) {
    update["finances.contractor"] = {
      isConfirmed: true,
      confirmedAt: new Date(),
      confirmedBy: contractor,
    };
  }
  if (customer) {
    update["finances.customer"] = {
      isConfirmed: true,
      confirmedAt: new Date(),
      confirmedBy: customer,
    };
  }
  await Work.updateMany({ _id: { $in: workIds } }, { $set: update });
};

/**
 * Сформировать отчёт из превью: посчитать деньги, при необходимости распилить
 * по филиалам, отправить клиенту и завести срок.
 */
const createReport = async ({
  companyId,
  servicePlanId,
  workIds,
  authedUser,
}) => {
  const context = await loadContext({ companyId, servicePlanId, workIds });
  const { company, servicePlan, preferences, works, zone, categoryById } =
    context;
  const attachment = context.attachment;

  const priced = priceWorks({
    plan: servicePlan,
    company,
    works,
    zone,
    categoryById,
  });

  const approvalRequired = Boolean(attachment.customerApprovalRequired);
  const bySubdivisions =
    approvalRequired && Boolean(attachment.subdivisionApprovalRequired);
  const actor = actorOf(authedUser);

  const report = new ServicePlanReport({
    company: company._id,
    servicePlan: servicePlan._id,
    works: works.map((work) => work._id),
    price: priced.price,
    additionalPrice: priced.additionalPrice,
    ...monthBoundsOf(works, zone),
    status: approvalRequired ? "pendingApproval" : "approved",
    approval: {
      required: approvalRequired,
      bySubdivisions,
      finalApprover: attachment.approver || null,
      submittedAt: approvalRequired ? new Date() : null,
      deadlineAt: null,
    },
    parts: bySubdivisions
      ? await buildParts({
          works,
          plan: servicePlan,
          company,
          zone,
          categoryById,
          priced,
        })
      : [],
    attempt: 1,
    createdBy: authedUser.userId || authedUser._id,
    updatedBy: authedUser.userId || authedUser._id,
  });

  if (approvalRequired) {
    await assertApprovalRoute(report, attachment);
    report.approval.deadlineAt = await computeDeadline(
      new Date(),
      preferences,
      zone,
    );
    // Очередь открывается только самым нижним подразделениям; вышестоящие ждут,
    // пока их ветка не подпишется
    if (bySubdivisions) {
      advanceWaves(report, (await buildPartTree(report)).childrenOf);
    }
    const recipients = await pendingApprovers(report);
    issueAccessTokens(
      report,
      preferences,
      recipients,
      await subdivisionByManager(report),
    );
    pushEvent(report, { actor: "contractor", by: actor, action: "submitted" });
  } else {
    pushEvent(report, { actor: "contractor", by: actor, action: "approved" });
  }

  await report.save();

  await applyWorkStage(
    report.works,
    approvalRequired ? "pendingApproval" : "approved",
    { contractor: actor },
  );

  if (approvalRequired) {
    await notifyApprovalRequested({
      report,
      company,
      servicePlan,
      recipients: await pendingApprovers(report),
      timezone: zone,
    });
  }

  return report;
};

/** Границы месяца отчёта — по самой ранней работе, в бизнес-таймзоне. */
const monthBoundsOf = (works, zone) => {
  const earliest = works.reduce(
    (found, work) =>
      !found || work.finishedAt < found ? work.finishedAt : found,
    null,
  );
  const anchor = dayjs(earliest).tz(zone);
  return {
    periodFrom: anchor.startOf("month").toDate(),
    periodTo: anchor.endOf("month").toDate(),
  };
};

/**
 * Часть, у которой есть свой подписант.
 *
 * «Без подразделения» таким не является: руководителя у остатка нет по
 * определению, и `canDecidePart` подписывать его прямо запрещает.
 */
const isDelegatedPart = (part) => Boolean(part.subdivision);

/**
 * Все ли делегированные части подписаны — можно ли отдавать на финальную
 * подпись.
 *
 * Остаток «Без подразделения» из условия исключён намеренно: пока он в него
 * входил, финальная подпись была недостижима — подписать остаток не мог никто,
 * а финал ждал ВСЕ части. Отчёт с таким остатком застревал навсегда, без
 * единого легального следующего шага. Теперь остаток закрывает финальный
 * согласующий вместе с итогом (см. finalize).
 */
const allPartsApproved = (report) =>
  (report.parts || [])
    .filter(isDelegatedPart)
    .every((part) => part.status === "approved");

/**
 * Решение клиента. `subdivisionId` задан — решается одна часть, иначе отчёт
 * целиком (финальная подпись).
 */
const decide = async ({ report, scope, authedUser, approve, comment, subdivisionId }) => {
  const actor = actorOf(authedUser);
  const [company, servicePlan, preferences] = await Promise.all([
    Company.findById(report.company).lean(),
    ServicePlan.findById(report.servicePlan).lean(),
    Preferences.findOne({}).lean(),
  ]);
  const zone = companyZone(company, resolveTimezone(preferences));

  if (subdivisionId) {
    const part = (report.parts || []).find(
      (item) => String(item.subdivision) === String(subdivisionId),
    );
    if (!part) {
      throw new AppError("Часть отчёта не найдена", 404);
    }
    if (!scope.canDecidePart(report, part)) {
      throw new AppError("Эта часть отчёта не ждёт вашего решения", 403);
    }

    part.status = approve ? "approved" : "declined";
    part.decidedBy = actor;
    part.decidedAt = new Date();
    part.comment = approve ? "" : comment || "";

    pushEvent(report, {
      actor: "customer",
      by: actor,
      action: approve ? "approved" : "declined",
      scope: "subdivision",
      subdivision: part.subdivision,
      subdivisionName: part.subdivisionName,
      comment: part.comment,
    });

    if (approve) {
      await applyWorkStage(part.works, "pendingApproval", { customer: actor });
    } else {
      // Спорная часть возвращается нам; подписи остальных остаются
      report.status = "declined";
      report.approval.deadlineAt = null;
      await applyWorkStage(part.works, "declined");
    }

    // Очередь снизу вверх: подпись могла закрыть ветку и открыть её
    // вышестоящему подразделению, а последняя ветка — передать ход финальному
    // согласующему. Ссылку выдаём ровно в этот момент: до своей очереди у
    // человека живой ссылки нет
    let opened = [];
    let finalRecipients = [];
    if (approve) {
      const { childrenOf } = await buildPartTree(report);
      opened = advanceWaves(report, childrenOf);
      if (opened.length > 0) {
        issueAccessTokens(
          report,
          preferences,
          await pendingApprovers(report),
          await subdivisionByManager(report),
        );
      } else if (allPartsApproved(report)) {
        finalRecipients = await pendingApprovers(report);
        issueAccessTokens(report, preferences, finalRecipients, new Map());
      }
    }

    report.updatedBy = authedUser.userId || authedUser._id;
    await report.save();

    await notifyDecision({
      report,
      company,
      servicePlan,
      recipients: await contractorRecipients(report),
      approved: approve,
      comment: part.comment,
      by: actor,
      subdivisionName: part.subdivisionName,
      timezone: zone,
    });

    if (opened.length > 0) {
      // Пишем ТОЛЬКО тем, чья очередь открылась: соседи по волне уже получили
      // своё письмо и второго ждать не должны
      await notifyApprovalRequested({
        report,
        company,
        servicePlan,
        recipients: await managersOfParts(opened),
        timezone: zone,
      });
    } else if (finalRecipients.length > 0) {
      await notifyApprovalRequested({
        report,
        company,
        servicePlan,
        recipients: finalRecipients,
        timezone: zone,
      });
    }

    return report;
  }

  if (!scope.canDecideReport(report)) {
    throw new AppError("Отчёт не ждёт вашего решения", 403);
  }

  await finalize({
    report,
    approve,
    comment,
    actor,
    actorKind: "customer",
    company,
    servicePlan,
    zone,
    authedUserId: authedUser.userId || authedUser._id,
  });

  return report;
};

/** Финальная подпись (клиентом или по сроку) — общая для решения и автоматики. */
const finalize = async ({
  report,
  approve,
  comment,
  actor,
  actorKind,
  company,
  servicePlan,
  zone,
  authedUserId,
}) => {
  report.status = approve ? "approved" : "declined";
  report.approval.deadlineAt = null;
  if (approve && actorKind === "system") {
    report.approval.autoApprovedAt = new Date();
  }

  // Финальная подпись закрывает всё, что осталось без решения: остаток «Без
  // подразделения» — всегда (своего подписанта у него нет), а при
  // автосогласовании по сроку ещё и части, до которых очередь не дошла. Иначе
  // утверждённый отчёт нёс бы части в статусе ожидания — состояние, которого у
  // закрытого документа быть не может
  for (const part of report.parts || []) {
    if (part.status === "approved" || part.status === "declined") {
      continue;
    }
    part.status = approve ? "approved" : "declined";
    // У автосогласования автора нет: подпись поставил срок, и карточка обязана
    // сказать это словами, а не чужим именем
    part.decidedBy = actor;
    part.decidedAt = new Date();
  }
  // Ссылки гаснут вместе с решением: повторно ими воспользоваться нельзя
  report.accessTokens = [];

  pushEvent(report, {
    actor: actorKind,
    by: actor,
    action: approve
      ? actorKind === "system"
        ? "autoApproved"
        : "approved"
      : "declined",
    scope: "report",
    comment: approve ? "" : comment || "",
  });

  if (authedUserId) {
    report.updatedBy = authedUserId;
  }
  await report.save();

  await applyWorkStage(
    report.works,
    approve ? "approved" : "declined",
    approve ? { customer: actor } : {},
  );

  const recipients = await contractorRecipients(report);
  if (actorKind === "system") {
    await notifyAutoApproved({
      report,
      company,
      servicePlan,
      recipients,
      timezone: zone,
    });
  } else {
    await notifyDecision({
      report,
      company,
      servicePlan,
      recipients,
      approved: approve,
      comment,
      by: actor,
      timezone: zone,
    });
  }
};

/**
 * Движение отчёта после согласования: счёт → оплата → архив.
 *
 * Раньше эти переходы жили в легаси-контроллере и не попадали в историю
 * документа — на карточке было не видно, кто и когда выставил счёт. Здесь
 * каждый шаг пишет событие, а порядок проверяет сервер, а не интерфейс.
 */
const issueInvoice = async ({ report, number, date, authedUser }) => {
  if (report.status !== "approved") {
    throw new AppError("Счёт выставляется только по утверждённому отчёту", 400);
  }
  report.invoice = { ...(report.invoice || {}), number, date };
  report.status = "awaitingPayment";
  pushEvent(report, {
    actor: "contractor",
    by: actorOf(authedUser),
    action: "invoiced",
    comment: `№ ${number}`,
  });
  report.updatedBy = authedUser.userId || authedUser._id;
  await report.save();
  return report;
};

const confirmPayment = async ({ report, paidAt, authedUser }) => {
  if (report.status !== "awaitingPayment") {
    throw new AppError("Оплата подтверждается по выставленному счёту", 400);
  }
  report.invoice = { ...(report.invoice || {}), fullyPaidAt: paidAt };
  report.status = "paid";
  pushEvent(report, {
    actor: "contractor",
    by: actorOf(authedUser),
    action: "paid",
  });
  report.updatedBy = authedUser.userId || authedUser._id;
  await report.save();
  return report;
};

const archiveReport = async ({ report, authedUser }) => {
  if (report.status !== "paid") {
    throw new AppError("В архив уходят только оплаченные отчёты", 400);
  }
  report.status = "archived";
  pushEvent(report, {
    actor: "contractor",
    by: actorOf(authedUser),
    action: "archived",
  });
  report.updatedBy = authedUser.userId || authedUser._id;
  await report.save();
  return report;
};

/**
 * Повторная отправка отклонённого отчёта: состав можно поправить (исключить
 * спорные работы), сумма пересчитывается, срок заводится заново.
 */
const resubmit = async ({ report, workIds, authedUser }) => {
  if (report.status !== "declined") {
    throw new AppError("Повторно отправляется только отклонённый отчёт", 400);
  }

  const ids = workIds?.length ? workIds : report.works;
  const context = await loadContext({
    companyId: report.company,
    servicePlanId: report.servicePlan,
    workIds: ids,
  });
  const { company, servicePlan, preferences, works, zone, categoryById } =
    context;

  const priced = priceWorks({
    plan: servicePlan,
    company,
    works,
    zone,
    categoryById,
  });
  const actor = actorOf(authedUser);

  // Работы, выпавшие из состава, возвращаются в превью — иначе они пропали бы
  // из биллинга навсегда
  const dropped = report.works
    .map(String)
    .filter((id) => !works.some((work) => String(work._id) === id));
  if (dropped.length > 0) {
    await Work.updateMany(
      { _id: { $in: dropped } },
      { $set: { "finances.status": "preview" }, $unset: { "finances.customer": "" } },
    );
  }

  report.works = works.map((work) => work._id);
  report.price = priced.price;
  report.additionalPrice = priced.additionalPrice;
  report.status = "pendingApproval";
  report.attempt += 1;
  report.approval.submittedAt = new Date();
  report.approval.remindedAt = null;
  report.approval.deadlineAt = await computeDeadline(
    new Date(),
    preferences,
    zone,
  );

  if (report.approval.bySubdivisions) {
    const rebuilt = await buildParts({
      works,
      plan: servicePlan,
      company,
      zone,
      categoryById,
      priced,
    });
    // Подписи, которые уже стоят, сохраняются: повторно беспокоить
    // руководителя, который свою часть подписал, нечестно
    const signed = new Map(
      (report.parts || [])
        .filter((part) => part.status === "approved")
        .map((part) => [String(part.subdivision), part]),
    );
    report.parts = rebuilt.map((part) => {
      const previous = signed.get(String(part.subdivision));
      return previous
        ? {
            ...part,
            status: "approved",
            decidedBy: previous.decidedBy,
            decidedAt: previous.decidedAt,
          }
        : part;
    });
    // Очередь пересобирается: подписанные ветки остаются закрытыми, спорная
    // часть снова открывается своему руководителю
    advanceWaves(report, (await buildPartTree(report)).childrenOf);
  }

  await assertApprovalRoute(report, context.attachment);
  issueAccessTokens(
    report,
    preferences,
    await pendingApprovers(report),
    await subdivisionByManager(report),
    { reset: true },
  );

  pushEvent(report, { actor: "contractor", by: actor, action: "resubmitted" });
  report.updatedBy = authedUser.userId || authedUser._id;
  await report.save();

  await applyWorkStage(report.works, "pendingApproval", { contractor: actor });

  await notifyApprovalRequested({
    report,
    company,
    servicePlan,
    recipients: await pendingApprovers(report),
    timezone: zone,
  });

  return report;
};

module.exports = {
  advanceWaves,
  buildPartTree,
  isDelegatedPart,
  archiveReport,
  assertApprovalRoute,
  confirmPayment,
  issueInvoice,
  computeDeadline,
  issueAccessTokens,
  tokenFor,
  subdivisionByManager,
  buildParts,
  createReport,
  decide,
  finalize,
  resubmit,
  pendingApprovers,
  contractorRecipients,
  applyWorkStage,
  allPartsApproved,
  monthBoundsOf,
};
