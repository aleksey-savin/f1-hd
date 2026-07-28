const ServicePlanReport = require("@/models/finances/servicePlanReport");
const Subdivision = require("@/models/subdivision");

const { AppError } = require("@/middleware/errorHandling");
const { allPartsApproved, decide } = require("@/services/reportApproval");
const {
  REPORT_WORKS_POPULATE,
  buildReportCard,
} = require("@/services/reportCard");
const { buildSubdivisionIndex } = require("@/services/subdivisionTree");

/**
 * Согласование отчёта по ссылке из письма — без входа в портал.
 *
 * Половина согласующих в приложение не заходит, и требовать логин ради одной
 * кнопки значит не получить решения вовсе. Токен персональный: он же
 * идентифицирует подписанта, поэтому подпись остаётся именной, а не
 * «согласовано по ссылке».
 *
 * Что здесь НЕ делается: доступ к остальному приложению. Отдаётся ровно один
 * отчёт и принимается ровно одно решение по нему.
 */

/** Токен → отчёт и подписант. Ошибки человеческие: экран покажет их как есть. */
const resolveToken = async (token) => {
  if (!token || token.length < 20) {
    throw new AppError("Ссылка повреждена", 404);
  }

  const report = await ServicePlanReport.findOne({
    "accessTokens.token": token,
  })
    // Тот же набор связей, что у карточки в кабинете: страница по ссылке
    // показывает ТОТ ЖЕ отчёт, а не его сокращение
    .populate({ path: "company", select: "alias fullTitle workSchedule timezone" })
    .populate({ path: "servicePlan" })
    // Автор — ради названия компании-исполнителя в маршруте подписей
    .populate({ path: "createdBy", select: "company" })
    .populate(REPORT_WORKS_POPULATE);

  if (!report) {
    throw new AppError("Ссылка недействительна", 404);
  }

  const entry = report.accessTokens.find((item) => item.token === token);
  if (entry.usedAt) {
    throw new AppError("По этой ссылке решение уже принято", 410);
  }
  if (entry.expiresAt && entry.expiresAt < new Date()) {
    throw new AppError("Срок действия ссылки истёк", 410);
  }
  if (report.status !== "pendingApproval") {
    throw new AppError("Отчёт больше не ждёт согласования", 409);
  }

  return { report, entry };
};

/**
 * Скоуп-подобный объект для владельца ссылки: те же предикаты, что у
 * services/reportApprovalScope, но полномочия ровно одного человека и ровно
 * по этому отчёту.
 */
const scopeOfToken = (entry) => ({
  canSeeReport: () => true,
  canDecideReport: (report) =>
    report.status === "pendingApproval" &&
    !entry.subdivision &&
    allPartsApproved(report),
  canDecidePart: (report, part) =>
    report.status === "pendingApproval" &&
    part.status === "pending" &&
    String(part.subdivision) === String(entry.subdivision),
});

/**
 * Что видно владельцу ссылки.
 *
 * Ссылка персональна и выдана под ОДНУ подпись, поэтому и окно у неё узкое:
 * своё подразделение и подчинённые ему — «свои работы плюс работы дочерних».
 * Итог договора и ставки в это окно не входят: подписывают часть, а не отчёт
 * компании. У ссылки финального согласующего ограничений нет — он подписывает
 * документ целиком и обязан видеть его целиком.
 */
const viewerOfToken = async (report, entry) => {
  if (!entry.subdivision) {
    return { subdivisions: null, money: "full" };
  }
  const docs = await Subdivision.find({
    company: report.company?._id || report.company,
  })
    .select("name parent company")
    .lean();
  const index = buildSubdivisionIndex(docs);
  const subtree = index.descendantsOf(String(entry.subdivision));
  return {
    subdivisions: new Set(
      subtree.length > 0 ? subtree.map(String) : [String(entry.subdivision)],
    ),
    money: "overtimeOnly",
  };
};

exports.getByToken = async (req, res, next) => {
  try {
    const { report, entry } = await resolveToken(req.params.token);

    const scope = scopeOfToken(entry);
    const part = entry.subdivision
      ? report.parts.find(
          (item) => String(item.subdivision) === String(entry.subdivision),
        )
      : null;

    // Карточка собирается тем же кодом, что и в кабинете
    const { zone, card } = await buildReportCard({
      report: report.toObject(),
      scope,
      viewer: await viewerOfToken(report, entry),
    });

    res.status(200).json({
      viewer: entry.user,
      zone,
      // Что именно подписывает владелец ссылки: часть филиала или отчёт целиком
      decides: entry.subdivision ? "subdivision" : "report",
      canDecide: entry.subdivision
        ? scope.canDecidePart(report, part || {})
        : scope.canDecideReport(report),
      expiresAt: entry.expiresAt,
      report: card,
    });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError("Не удалось открыть отчёт", 500, true, error),
    );
  }
};

exports.decideByToken = async (req, res, next) => {
  try {
    const { report, entry } = await resolveToken(req.params.token);
    const { approve, comment } = req.body;

    if (!approve && !String(comment || "").trim()) {
      return next(new AppError("Укажите причину отклонения", 400));
    }

    await decide({
      report,
      scope: scopeOfToken(entry),
      // Подпись именная: владелец токена и есть подписант
      authedUser: {
        userId: entry.user?._id,
        _id: entry.user?._id,
        firstName: entry.user?.firstName,
        lastName: entry.user?.lastName,
      },
      approve: Boolean(approve),
      comment,
      subdivisionId: entry.subdivision || undefined,
    });

    // Ссылка одноразовая: решение принято — второй раз ею не воспользоваться.
    // Отчёт мог быть перезаписан внутри decide, поэтому гасим отдельным update.
    await ServicePlanReport.updateOne(
      { _id: report._id, "accessTokens.token": req.params.token },
      { $set: { "accessTokens.$.usedAt": new Date() } },
    );

    res.status(200).json({ ok: true, approved: Boolean(approve) });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError("Не удалось записать решение", 500, true, error),
    );
  }
};
