const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const Company = require("@/models/company");
const Preferences = require("@/models/preferences");
const ServicePlan = require("@/models/finances/servicePlan");
const ServicePlanReport = require("@/models/finances/servicePlanReport");
const Work = require("@/models/work");

const { AppError } = require("@/middleware/errorHandling");
const {
  buildPreview,
  companyZone,
  normalizePlan,
  priceWorks,
} = require("@/services/servicePlanBilling");
const TicketCategory = require("@/models/ticketCategory");
const {
  archiveReport,
  confirmPayment,
  createReport,
  decide,
  issueInvoice,
  resubmit,
} = require("@/services/reportApproval");
const {
  resolveReportApprovalScope,
  serializeApprovalScope,
} = require("@/services/reportApprovalScope");
const {
  REPORT_WORKS_POPULATE,
  buildReportCard,
  resolveSubdivisions,
  splitWorkTables,
  toRow,
} = require("@/services/reportCard");
const { resolveTimezone } = require("@/utils/datetime");

/**
 * «Согласование работ»: конвейер и карточка отчёта.
 *
 * Один экран на две аудитории — нам он показывает очередь по стадиям, клиенту
 * только то, что ждёт его подписи. Объём считает сервер
 * (services/reportApprovalScope), интерфейс лишь меняет форму.
 */

// Стадии конвейера в том же порядке и с теми же названиями, что в фильтре
// прежнего экрана: «Превью» → «На утверждении» → «Ожидает выставления счёта»
// → «Ждём оплаты» → «Оплачен». Переименований в этой работе нет.
const PIPELINE_STAGES = [
  "preview",
  "pendingApproval",
  "approved",
  "awaitingPayment",
  "paid",
];

/** Работы с заявками и заявителями — общий разбор для карточки и подбора. */
const loadWorkDetails = (workIds) =>
  Work.find({ _id: { $in: workIds || [] } })
    .select("description startedAt finishedAt withinPlan finishedBy tickets company")
    .populate({
      path: "tickets",
      // Тема, описание и категория нужны на месте: по работам вне услуг
      // решение о новой категории принимают прямо в карточке, и уходить в
      // заявку за текстом обращения — лишний круг. htmlDescription не берём:
      // это разметка письма, в модалку она не годится
      select: "num title description categoryId applicantId",
      populate: [
        { path: "applicantId", select: "firstName lastName" },
        { path: "categoryId", select: "title" },
      ],
    })
    .sort({ finishedAt: 1 })
    .lean();

/** Длительность работы в минутах — для строк, которых нет в расчёте. */
const rawMinutes = (work) =>
  work.startedAt && work.finishedAt
    ? Math.max(0, new Date(work.finishedAt) - new Date(work.startedAt)) / 60000
    : 0;

const daysBetween = (from, to) =>
  Math.floor((new Date(to) - new Date(from)) / 86400000);

/**
 * Строка списка под зрителя: руководителю филиала итог договора не показываем,
 * а объём считаем по его частям. Обе цифры берём из уже сохранённых частей —
 * пересчитывать подмножество нельзя, при пакетах часов доля ветки бессмысленна.
 */
const restrictRow = (row, report, viewer) => {
  if (!viewer?.subdivisions && viewer?.money !== "overtimeOnly") {
    return row;
  }

  const mine = (report.parts || []).filter(
    (part) =>
      part.subdivision && viewer.subdivisions?.has(String(part.subdivision)),
  );

  return {
    ...row,
    parts: row.parts.filter(
      (part) =>
        part.subdivision && viewer.subdivisions?.has(String(part.subdivision)),
    ),
    worksCount: mine.reduce((sum, part) => sum + (part.works || []).length, 0),
    price: null,
    total: null,
    // Единственные деньги, которые его касаются
    additionalPrice: mine.reduce(
      (sum, part) => sum + (part.additionalPrice || 0),
      0,
    ),
    money: "overtimeOnly",
  };
};

exports.getPipeline = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const scope = await resolveReportApprovalScope(authedUser);

    if (scope.kind === "none") {
      return res.status(200).json({
        scope: serializeApprovalScope(scope),
        preview: [],
        reports: [],
        stages: {},
      });
    }

    const preferences = await Preferences.findOne({}).lean();
    const zone = resolveTimezone(preferences);

    const query = { status: { $ne: "archived" } };
    if (scope.kind === "scoped") {
      query.company = { $in: scope.companyIds };
    }

    const [reports, preview] = await Promise.all([
      ServicePlanReport.find(query)
        .populate({ path: "company", select: "alias fullTitle timezone" })
        .populate({ path: "servicePlan", select: "title type" })
        .sort({ periodFrom: -1 })
        .lean(),
      // Превью — стадия только нашей стороны: клиент не участвует в подборе
      scope.kind === "all" ? buildPreview() : Promise.resolve([]),
    ]);

    const visible = reports.filter((report) => scope.canSeeReport(report));
    const rows = visible.map((report) =>
      restrictRow(
        // Месяц считаем в зоне компании-клиента: в браузере она другая, и
        // первое число месяца уезжало на предыдущий
        toRow(report, scope, companyZone(report.company, zone)),
        report,
        scope.viewerOf(report),
      ),
    );

    const now = new Date();
    const stages = {};
    for (const stage of PIPELINE_STAGES) {
      if (stage === "preview") {
        stages.preview = {
          count: preview.length,
          total: preview.reduce((sum, row) => sum + row.total, 0),
          unrelatedWorks: preview.reduce(
            (sum, row) => sum + (row.unrelatedWorksCount || 0),
            0,
          ),
        };
        continue;
      }

      const inStage = rows.filter((row) => row.status === stage);
      const stat = {
        count: inStage.length,
        total: inStage.reduce((sum, row) => sum + row.total, 0),
      };

      if (stage === "pendingApproval") {
        // Часы стадии — ближайшая автоподпись: это и есть её живой вопрос
        const deadlines = inStage
          .map((row) => row.approval?.deadlineAt)
          .filter(Boolean)
          .sort();
        stat.nearestDeadlineAt = deadlines[0] || null;
        stat.nearestDeadlineDays = deadlines[0]
          ? daysBetween(now, deadlines[0])
          : null;
      }
      if (stage === "approved") {
        // Сколько дней самый старый отчёт ждёт счёта
        const oldest = inStage
          .map((row) => row.updatedAt)
          .filter(Boolean)
          .sort()[0];
        stat.oldestDays = oldest ? daysBetween(oldest, now) : null;
      }
      if (stage === "awaitingPayment") {
        const oldest = inStage
          .map((row) => row.invoice?.date)
          .filter(Boolean)
          .sort()[0];
        stat.oldestInvoiceDays = oldest ? daysBetween(oldest, now) : null;
      }

      stages[stage] = stat;
    }

    // Отклонённые в конвейере отдельной стадией не стоят — это возврат в нашу
    // работу, а не движение вперёд; показываем счётчиком рядом с «На утверждении»
    const declined = rows.filter((row) => row.status === "declined");
    stages.declined = {
      count: declined.length,
      total: declined.reduce((sum, row) => sum + row.total, 0),
    };

    res.status(200).json({
      scope: serializeApprovalScope(scope),
      zone,
      preview,
      reports: rows,
      stages,
    });
  } catch (error) {
    next(new AppError("Не удалось собрать конвейер согласования", 500, true, error));
  }
};

exports.getReport = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const scope = await resolveReportApprovalScope(authedUser);

    const report = await ServicePlanReport.findById(req.params.id)
      .populate({ path: "company", select: "alias fullTitle workSchedule timezone" })
      .populate({ path: "servicePlan" })
      .populate({ path: "createdBy", select: "company" })
      .populate(REPORT_WORKS_POPULATE)
      .lean();

    if (!report) {
      return next(new AppError("Отчёт не найден", 404));
    }
    if (!scope.canSeeReport(report)) {
      return next(new AppError("Отчёт вам недоступен", 403));
    }

    // Разбивка расчёта — из того же сервиса, что считал деньги при отправке:
    // карточка обязана показывать, ПО ЧЕМУ посчитано, а не только сколько
    const { zone, card } = await buildReportCard({
      report,
      scope,
      // Руководителю филиала — только его ветка и только деньги за нерабочее
      // время; ограничение считает сервер, а не прячет интерфейс
      viewer: scope.viewerOf(report),
    });

    res.status(200).json({
      scope: serializeApprovalScope(scope),
      zone,
      report: card,
    });
  } catch (error) {
    next(new AppError("Не удалось открыть отчёт", 500, true, error));
  }
};

/**
 * Карточка подбора: тот же разбор, что у сохранённого отчёта, но по строке,
 * которая отчётом ещё не стала.
 *
 * Ради этого экран и существует: перед подписью надо ПРОВЕРИТЬ состав — какие
 * работы вошли, что попало в нерабочее время, по какому тарифу посчитано.
 * Раньше это показывал offcanvas «расшифровка», и без него кнопка «Утвердить»
 * предлагает подписать вслепую.
 */
exports.getPreviewCard = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const scope = await resolveReportApprovalScope(authedUser);
    if (scope.kind !== "all") {
      return next(new AppError("Подбор доступен только исполнителю", 403));
    }

    const { companyId, servicePlanId, month } = req.params;
    const rows = await buildPreview({ companyIds: [companyId] });
    const row = rows.find(
      (item) =>
        String(item.servicePlan._id) === String(servicePlanId) &&
        item.month === month,
    );

    if (!row) {
      return next(
        new AppError("За этот месяц по услуге нечего согласовывать", 404),
      );
    }

    const [preferences, categories, works, unrelatedWorks] = await Promise.all([
      Preferences.findOne({}).lean(),
      TicketCategory.find({}).select("title alwaysWithinPlan").lean(),
      loadWorkDetails(row.workIds),
      loadWorkDetails(row.unrelatedWorkIds || []),
    ]);

    const company = await Company.findById(companyId).lean();
    const servicePlan = await ServicePlan.findById(servicePlanId).lean();
    const zone = companyZone(company, resolveTimezone(preferences));
    const categoryById = new Map(
      categories.map((category) => [String(category._id), category]),
    );
    const priced = priceWorks({
      plan: servicePlan,
      company,
      works,
      zone,
      categoryById,
    });
    const attribution = await resolveSubdivisions({ company, works });
    const tariff = normalizePlan(servicePlan);

    res.status(200).json({
      scope: serializeApprovalScope(scope),
      zone,
      report: {
        _id: null,
        status: "preview",
        month: row.month,
        company: { _id: company._id, alias: company.alias, fullTitle: company.fullTitle },
        servicePlan: { _id: servicePlan._id, title: servicePlan.title },
        periodFrom: `${row.month}-01`,
        price: priced.price,
        additionalPrice: priced.additionalPrice,
        total: priced.total,
        worksCount: works.length,
        attempt: 1,
        approval: {
          required: row.approval.required,
          bySubdivisions: row.approval.bySubdivisions,
          finalApprover: row.approval.approver,
          submittedAt: null,
          deadlineAt: null,
        },
        parts: [],
        works,
        timeline: [],
        ...splitWorkTables(works, priced, attribution.subdivisionOf),
        subdivisions: attribution.subdivisions,
        workIds: row.workIds,
        // Работы вне услуг — причина, по которой отчёт не сформировать.
        // Показываются той же таблицей, что и остальные работы, поэтому
        // длительность им нужна такая же
        unrelatedWorks: unrelatedWorks.map((work) => ({
          ...work,
          billedMinutes: rawMinutes(work),
        })),
        calc: {
          workingTimeMinutes: priced.workingTimeMinutes,
          overtimeMinutes: priced.overtimeMinutes,
          price: priced.price,
          additionalPrice: priced.additionalPrice,
          total: priced.total,
        },
        terms: {
          type: tariff.type,
          tariffingPeriod: tariff.tariffingPeriod,
          hourPackages: tariff.hourPackages,
          // Основание цены пакета приходит из того же расчёта, что и деньги
          packageBasis: priced.packageBasis,
          fixedPrice: tariff.fixedPrice,
          pricePerHour: tariff.pricePerHour,
          pricePerHourNonWorking: tariff.pricePerHourNonWorking,
          approval: {
            required: row.approval.required,
            bySubdivisions: row.approval.bySubdivisions,
          },
        },
      },
    });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError("Не удалось открыть подбор", 500, true, error),
    );
  }
};

/**
 * Работы вне услуг по компании за месяц — для правки прямо из конвейера.
 *
 * Их чинят там, где увидели: кнопка в строке компании открывает модалку с
 * заявкой, а не уводит на карточку подбора. Поэтому данные нужны отдельным
 * лёгким запросом, а не раздуванием ответа конвейера.
 */
exports.getUnrelated = async (req, res, next) => {
  try {
    const { companyId, month } = req.params;
    const rows = await buildPreview({ companyIds: [companyId] });
    const ids = [
      ...new Set(
        rows
          .filter((row) => row.month === month)
          .flatMap((row) => row.unrelatedWorkIds || [])
          .map(String),
      ),
    ];

    const works = await loadWorkDetails(ids);
    res.status(200).json({
      works: works.map((work) => ({ ...work, billedMinutes: rawMinutes(work) })),
    });
  } catch (error) {
    next(
      new AppError("Не удалось загрузить работы вне услуг", 500, true, error),
    );
  }
};

exports.create = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const { companyId, servicePlanId, workIds } = req.body;

    const report = await createReport({
      companyId,
      servicePlanId,
      workIds,
      authedUser,
    });

    res.status(201).json({ report });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError("Не удалось сформировать отчёт", 500, true, error),
    );
  }
};

exports.resubmit = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const report = await ServicePlanReport.findById(req.params.id);
    if (!report) {
      return next(new AppError("Отчёт не найден", 404));
    }

    await resubmit({ report, workIds: req.body.workIds, authedUser });
    res.status(200).json({ report });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError("Не удалось отправить отчёт повторно", 500, true, error),
    );
  }
};

/** Шаги после согласования: счёт, оплата, архив. */
const stageAction = (run) => async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const report = await ServicePlanReport.findById(req.params.id);
    if (!report) {
      return next(new AppError("Отчёт не найден", 404));
    }
    await run({ report, body: req.body, authedUser });
    res.status(200).json({ report });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError("Не удалось выполнить действие", 500, true, error),
    );
  }
};

exports.invoice = stageAction(({ report, body, authedUser }) =>
  issueInvoice({
    report,
    number: body.number,
    date: body.date,
    authedUser,
  }),
);

exports.payment = stageAction(({ report, body, authedUser }) =>
  confirmPayment({ report, paidAt: body.paidAt, authedUser }),
);

exports.archive = stageAction(({ report, authedUser }) =>
  archiveReport({ report, authedUser }),
);

exports.decision = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const scope = await resolveReportApprovalScope(authedUser);

    const report = await ServicePlanReport.findById(req.params.id);
    if (!report) {
      return next(new AppError("Отчёт не найден", 404));
    }
    if (!scope.canSeeReport(report.toObject())) {
      return next(new AppError("Отчёт вам недоступен", 403));
    }

    const { approve, comment, subdivisionId } = req.body;
    if (!approve && !String(comment || "").trim()) {
      return next(new AppError("Укажите причину отклонения", 400));
    }

    await decide({
      report,
      scope,
      authedUser,
      approve: Boolean(approve),
      comment,
      subdivisionId,
    });

    res.status(200).json({ report });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError("Не удалось записать решение", 500, true, error),
    );
  }
};
