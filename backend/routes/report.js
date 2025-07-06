const Router = require("express");
const router = new Router();
const reportController = require("../controllers/report");
const isAuth = require("../middleware/isAuth");

const {
  canSeeWorksReport,
  timeTrackingModuleIsActive,
  canUseTimeTrackingModule,
} = require("../middleware/permissions");

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

module.exports = router;
