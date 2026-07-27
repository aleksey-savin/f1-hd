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
  financesModuleIsActive,
  canUseFinancesModule,
  canSeeGlobalFinancialReport,
  canSeePersonalOrGlobalFinancialReport,
  canConfirmReportActions,
} = require("@/middleware/permissions");

router.get(
  "/summary-report-preview",
  isAuth,
  canSeeGlobalFinancialReport,
  reportController.summaryReportPreview,
);

router.get(
  "/active-reports",
  isAuth,
  canSeeGlobalFinancialReport,
  reportController.getAllActive,
);

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
  "/summary-report/confirm-works-by-contractor",
  isAuth,
  canConfirmReportActions,
  reportValidation.confirmWorksByContractor,
  runValidation,
  reportController.confirmWorksByContractor,
);

router.patch(
  "/summary-report/create-invoice",
  isAuth,
  canConfirmReportActions,
  reportValidation.createInvoice,
  runValidation,
  reportController.createInvoice,
);

router.patch(
  "/summary-report/confirm-payment",
  isAuth,
  canConfirmReportActions,
  reportValidation.confirmPayment,
  runValidation,
  reportController.confirmPayment,
);

router.patch(
  "/summary-report/archive",
  isAuth,
  canConfirmReportActions,
  reportValidation.archive,
  runValidation,
  reportController.archive,
);

router.post(
  "/employee-report",
  isAuth,
  canSeeGlobalFinancialReport,
  reportValidation.employeeReport,
  runValidation,
  reportController.getEmployeeReport,
);

router.delete(
  "/summary-report/delete",
  isAuth,
  canConfirmReportActions,
  reportValidation.delete,
  runValidation,
  reportController.delete,
);

module.exports = router;
