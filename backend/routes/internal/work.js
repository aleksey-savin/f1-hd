const Router = require("express");
const router = new Router();
const workController = require("@/controllers/work");
const isAuth = require("@/middleware/isAuth");

const {
  timeTrackingModuleIsActive,
  canUseTimeTrackingModule,
  canSeeWorksReport,
} = require("@/middleware/permissions");

// Архив работ (сегмент «Работы» страницы «Архив») — гейты прежнего
// отчёта по работам
router.get(
  "/works",
  isAuth,
  timeTrackingModuleIsActive,
  canUseTimeTrackingModule,
  canSeeWorksReport,
  workController.getFinished,
);

router.get(
  "/works/additional-data/:ticketNum",
  isAuth,
  workController.getAdditionalData,
);
// Предварительный расчёт по черновику работы: ничего не сохраняет, суммы
// отдаёт только тем, кому положено (controllers/work.js → canSeeMoney)
router.post("/works/preview", isAuth, workController.preview);
router.get("/works/:ticketNum", isAuth, workController.getTicketWorks);
router.get("/all-scheduled-works", isAuth, workController.getAllScheduled);

router.post("/works/add", isAuth, workController.add);
router.post("/works/schedule", isAuth, workController.schedule);
router.post("/works/update/:workId", isAuth, workController.update);
router.post("/works/delete", isAuth, workController.delete);

module.exports = router;
