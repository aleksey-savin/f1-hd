const Preferences = require("@/models/preferences");

const { AppError } = require("@/middleware/errorHandling");

const {
  resolveCompaniesReportScope,
  serializeScope,
} = require("@/services/reportScope");
const {
  buildCompaniesSummary,
  buildCompanyCard,
  buildSubdivisionCard,
  buildCompaniesTrends,
} = require("@/services/companiesReportService");

/**
 * Отчёт «Компании». Контроллер тонкий: читает пользователя и настройки, считает
 * скоуп доступа и отдаёт результат сервиса. Право `canSeeAnalytics` проверено
 * middleware, объём данных — резолвером (services/reportScope).
 */

const withScope = (handler) => async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const [preferences, scope] = await Promise.all([
      Preferences.findOne({}),
      resolveCompaniesReportScope(authedUser),
    ]);

    const payload = await handler({ req, scope, preferences });

    res.status(200).json({ ...payload, scope: serializeScope(scope) });
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError("Failed to build companies report", 500, true, error),
    );
  }
};

exports.getSummary = withScope(({ req, scope, preferences }) =>
  buildCompaniesSummary({
    from: req.query.from,
    to: req.query.to,
    scope,
    preferences,
  }),
);

exports.getTrends = withScope(({ req, scope, preferences }) =>
  buildCompaniesTrends({
    period: req.query.period,
    grouping: req.query.grouping,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    scope,
    preferences,
  }),
);

exports.getCompany = withScope(({ req, scope, preferences }) =>
  buildCompanyCard({
    companyId: req.params.companyId,
    from: req.query.from,
    to: req.query.to,
    scope,
    preferences,
  }),
);

exports.getSubdivision = withScope(({ req, scope, preferences }) =>
  buildSubdivisionCard({
    companyId: req.params.companyId,
    subdivisionId: req.params.subdivisionId,
    from: req.query.from,
    to: req.query.to,
    // По умолчанию карточка показывает подразделение с вложенными: руководитель
    // отвечает за всё поддерево, и «только сам узел» — это уточнение, а не норма
    includeDescendants: req.query.includeDescendants !== "false",
    scope,
    preferences,
  }),
);
