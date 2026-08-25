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
  canReadEmployeesReport,
  canReadPersonalReport,
} = require("@/middleware/permissions");

router.get(
  "/personal-report-summary",
  isAuth,
  canReadPersonalReport,
  reportValidation.personalSummary,
  runValidation,
  personalReportController.getSummary,
);


router.get(
  "/employees-summary",
  isAuth,
  canReadEmployeesReport,
  reportValidation.employeesSummary,
  runValidation,
  employeesSummaryController.getSummary,
);

router.get(
  "/employees-trend",
  isAuth,
  canReadEmployeesReport,
  reportValidation.employeesTrend,
  runValidation,
  employeesTrendController.getTrend,
);

router.post(
  "/employee-report",
  isAuth,
  canReadEmployeesReport,
  reportValidation.employeeReport,
  runValidation,
  reportController.getEmployeeReport,
);

module.exports = router;
