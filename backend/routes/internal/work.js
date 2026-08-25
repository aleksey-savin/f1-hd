const Router = require("express");
const router = new Router();
const workController = require("@/controllers/work");
const isAuth = require("@/middleware/isAuth");

const {
  timeTrackingModuleIsActive,
  canReadWorks,
  canLogWorks,
  canReadWorksReport,
  allowedToViewTicket,
  requireTicketsAccess,
} = require("@/middleware/permissions");

// Работа принадлежит заявкам из тела запроса — каждая должна быть доступна
// тому, кто её пишет. Иначе номер чужой заявки в теле давал бы и запись работы,
// и отметку в её журнале.
const ticketsFromBody = requireTicketsAccess((req) => req.body.tickets);

// Архив работ (сегмент «Работы» страницы «Архив») — гейты прежнего
// отчёта по работам
router.get(
  "/works",
  isAuth,
  timeTrackingModuleIsActive,
  canReadWorks,
  canReadWorksReport,
  workController.getFinished,
);

router.get(
  "/works/additional-data/:ticketNum",
  isAuth,
  allowedToViewTicket,
  workController.getAdditionalData,
);
// Предварительный расчёт по черновику работы: ничего не сохраняет, суммы
// отдаёт только тем, кому положено (controllers/work.js → canSeeMoney)
router.post("/works/preview", isAuth, ticketsFromBody, workController.preview);
router.get(
  "/works/:ticketNum",
  isAuth,
  allowedToViewTicket,
  workController.getTicketWorks,
);
router.get("/all-scheduled-works", isAuth, workController.getAllScheduled);

router.post(
  "/works/add",
  isAuth,
  canLogWorks,
  ticketsFromBody,
  workController.add,
);
router.post(
  "/works/schedule",
  isAuth,
  canLogWorks,
  ticketsFromBody,
  workController.schedule,
);
// Заявки правки берутся из работы, если тело их не прислало, поэтому доступ к
// ним проверяет контроллер — там же, где решается «своя это работа или чужая».
router.post(
  "/works/update/:workId",
  isAuth,
  canLogWorks,
  workController.update,
);
router.post(
  "/works/delete",
  isAuth,
  canLogWorks,
  workController.delete,
);

module.exports = router;
