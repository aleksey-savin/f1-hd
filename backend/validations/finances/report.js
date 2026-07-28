const { body, query } = require("express-validator");

exports.personalSummary = [
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
  query("userId")
    .optional()
    .isMongoId()
    .withMessage("User ID must be a valid MongoDB ID"),
];

exports.employeesSummary = [
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
  query("approvedOnly")
    .optional()
    .isBoolean()
    .withMessage("approvedOnly must be a boolean"),
];

exports.employeesTrend = [
  query("to").optional().isISO8601().withMessage("Invalid date format"),
  query("months")
    .optional()
    .isInt({ min: 1, max: 12 })
    .withMessage("Months must be between 1 and 12"),
  query("approvedOnly")
    .optional()
    .isBoolean()
    .withMessage("approvedOnly must be a boolean"),
];

exports.employeeReport = [
  body("periodFrom")
    .notEmpty()
    .withMessage("Period start date is required")
    .isDate()
    .withMessage("Invalid start date format"),
  body("periodTo")
    .notEmpty()
    .withMessage("Period end date is required")
    .isDate()
    .withMessage("Invalid end date format"),
];
