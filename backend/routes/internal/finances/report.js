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
  financesModuleIsActive,
  canUseFinancesModule,
  canSeeGlobalFinancialReport,
  reportController.summaryReportPreview,
);

router.get(
  "/active-reports",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canSeeGlobalFinancialReport,
  reportController.getAllActive,
);

router.get(
  "/personal-report/:date",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canSeePersonalFinancialReport,
  reportController.getPersonalReport,
);

router.get(
  "/personal-report",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canSeePersonalFinancialReport,
  reportController.getPersonalReportByRange,
);

router.get(
  "/personal-preview",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canSeePersonalFinancialReport,
  reportController.getPersonalPreviewWorks,
);

router.post(
  "/summary-report/confirm-works-by-contractor",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canConfirmReportActions,
  reportValidation.confirmWorksByContractor,
  runValidation,
  reportController.confirmWorksByContractor,
);

router.patch(
  "/summary-report/create-invoice",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  reportValidation.createInvoice,
  runValidation,
  reportController.createInvoice,
);

router.patch(
  "/summary-report/confirm-payment",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  reportValidation.confirmPayment,
  runValidation,
  reportController.confirmPayment,
);

router.patch(
  "/summary-report/archive",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canConfirmReportActions,
  reportValidation.archive,
  runValidation,
  reportController.archive,
);

router.post(
  "/employee-report",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  canSeeGlobalFinancialReport,
  reportValidation.employeeReport,
  runValidation,
  reportController.getEmployeeReport,
);

router.delete(
  "/summary-report/delete",
  isAuth,
  financesModuleIsActive,
  canUseFinancesModule,
  reportValidation.delete,
  runValidation,
  reportController.delete,
);

module.exports = router;
