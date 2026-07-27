const { param, query } = require("express-validator");

// Отчёт «Компании». Раньше валидации у отчёта не было вовсе: битая дата
// доходила до контроллера, а `from=2015-01-01` вытягивал всю коллекцию работ
// (ограничение длины периода живёт в сервисе, здесь — формат и идентификаторы).

const periodQuery = [
  query("from")
    .notEmpty()
    .withMessage("Period start date is required")
    .isISO8601()
    .withMessage("Invalid start date format"),
  query("to")
    .notEmpty()
    .withMessage("Period end date is required")
    .isISO8601()
    .withMessage("Invalid end date format"),
];

exports.companiesSummary = periodQuery;

exports.companyCard = [
  param("companyId").isMongoId().withMessage("Company ID must be a valid MongoDB ID"),
  ...periodQuery,
];

exports.subdivisionCard = [
  param("companyId").isMongoId().withMessage("Company ID must be a valid MongoDB ID"),
  param("subdivisionId")
    .isMongoId()
    .withMessage("Subdivision ID must be a valid MongoDB ID"),
  ...periodQuery,
  query("includeDescendants")
    .optional()
    .isBoolean()
    .withMessage("includeDescendants must be a boolean"),
];

exports.companiesTrends = [
  query("period")
    .isIn(["12months", "currentYear", "lastYear", "custom"])
    .withMessage("Invalid trends period"),
  query("grouping")
    .optional()
    .isIn(["month", "quarter", "week"])
    .withMessage("Invalid grouping"),
  query("startDate").optional().isISO8601().withMessage("Invalid start date format"),
  query("endDate").optional().isISO8601().withMessage("Invalid end date format"),
];
