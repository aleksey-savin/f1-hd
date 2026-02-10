const Router = require("express");
const router = new Router();
const reportController = require("@/controllers/finances/report");
const isAuth = require("@/middleware/isAuth");

const { runValidation } = require("@/middleware/runValidation");
const reportValidation = require("@/validations/finances/report");

const {
  financesModuleIsActive,
  canUseFinancesModule,
  canSeeGlobalFinancialReport,
  canSeePersonalFinancialReport,
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
  "/personal-report/:date",
  isAuth,
  canSeePersonalFinancialReport,
  reportController.getPersonalReport,
);

router.get(
  "/personal-report",
  isAuth,
  canSeePersonalFinancialReport,
  reportController.getPersonalReportByRange,
);

router.get(
  "/personal-preview",
  isAuth,
  canSeePersonalFinancialReport,
  reportController.getPersonalPreviewWorks,
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
  reportValidation.createInvoice,
  runValidation,
  reportController.createInvoice,
);

router.patch(
  "/summary-report/confirm-payment",
  isAuth,
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
  reportValidation.delete,
  runValidation,
  reportController.delete,
);

module.exports = router;
