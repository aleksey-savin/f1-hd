const Preferences = require("../../models/preferences");

const {
  buildEmployeesSummary,
} = require("../../services/employeesSummaryService");

const { AppError } = require("../../middleware/errorHandling");

const MAX_PERIOD_DAYS = 366;

// GET /finances/employees-summary?from&to[&approvedOnly]
// Сводка по всем сотрудникам: часы, классы работ, переработки и доплата.
// Доступ — только с правом на полный финансовый отчёт (гейт в роуте);
// свой отчёт сотрудника живёт в personal-report-summary.
//
// Право на отчёт даёт часы и переработки; ставки и доплаты — отдельное право
// `user.manageFinances` (свои деньги каждый видит в своём отчёте).
exports.getSummary = async (req, res, next) => {
  try {
    const { from, to, approvedOnly } = req.query;

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return next(new AppError("Некорректный период отчёта", 400));
    }
    if (toDate < fromDate) {
      return next(
        new AppError("Дата окончания периода раньше даты начала", 400),
      );
    }
    if (toDate - fromDate > MAX_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
      return next(
        new AppError(
          `Период отчёта не может превышать ${MAX_PERIOD_DAYS} дней`,
          400,
        ),
      );
    }

    const preferences = await Preferences.findOne({}).lean();

    const report = await buildEmployeesSummary({
      from,
      to,
      approvedOnly: approvedOnly === "true",
      preferences,
      canSeeMoney: Boolean(req.auth?.can({ user: ["manageFinances"] })),
    });

    res.status(200).json(report);
  } catch (error) {
    next(
      new AppError("Failed to build employees summary", 500, true, error),
    );
  }
};
