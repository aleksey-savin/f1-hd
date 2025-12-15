const Router = require("express");
const router = new Router();
const reportController = require("@/controllers/report");
const isAuth = require("@/middleware/isAuth");

const {
  canSeeWorksReport,
  canSeeAnalytics,
  timeTrackingModuleIsActive,
  canUseTimeTrackingModule,
} = require("@/middleware/permissions");

router.get(
  "/report/form-data",
  isAuth,
  timeTrackingModuleIsActive,
  canUseTimeTrackingModule,
  canSeeWorksReport,
  reportController.getFormData,
);

router.post(
  "/report/works",
  isAuth,
  timeTrackingModuleIsActive,
  canUseTimeTrackingModule,
  canSeeWorksReport,
  reportController.filterWorks,
);

router.post(
  "/report/analytics",
  isAuth,
  timeTrackingModuleIsActive,
  canUseTimeTrackingModule,
  canSeeAnalytics,
  reportController.getCompanySummary,
);

router.post(
  "/report/trends-analysis",
  isAuth,
  timeTrackingModuleIsActive,
  canUseTimeTrackingModule,
  canSeeAnalytics,
  reportController.getTrendsAnalysis,
);

module.exports = router;
