const Router = require("express");
const router = new Router();
const reportController = require("@/controllers/finances/report");
const personalReportController = require("@/controllers/finances/personalReport");
const employeesSummaryController = require("@/controllers/finances/employeesSummary");
const employeesTrendController = require("@/controllers/finances/employeesTrend");
const isAuth = require("@/middleware/isAuth");

const { runValidation } = require("@/middleware/runValidation");
const reportValidation = require("@/validations/finances/report");

const {
  canSeeGlobalFinancialReport,
  canSeePersonalOrGlobalFinancialReport,
} = require("@/middleware/permissions");

router.get(
  "/personal-report-summary",
  isAuth,
  canSeePersonalOrGlobalFinancialReport,
  reportValidation.personalSummary,
  runValidation,
  personalReportController.getSummary,
);

router.get(
  "/report-employees",
  isAuth,
  canSeeGlobalFinancialReport,
  personalReportController.getReportEmployees,
);

router.get(
  "/employees-summary",
  isAuth,
  canSeeGlobalFinancialReport,
  reportValidation.employeesSummary,
  runValidation,
  employeesSummaryController.getSummary,
);

router.get(
  "/employees-trend",
  isAuth,
  canSeeGlobalFinancialReport,
  reportValidation.employeesTrend,
  runValidation,
  employeesTrendController.getTrend,
);

router.post(
  "/employee-report",
  isAuth,
  canSeeGlobalFinancialReport,
  reportValidation.employeeReport,
  runValidation,
  reportController.getEmployeeReport,
);

module.exports = router;
