const Router = require("express");
const router = new Router();
const ticketController = require("../controllers/ticket");
const isAuth = require("../middleware/isAuth");
const isTelegramBot = require("../middleware/isTelegramBot");
const {
  allowedToViewTicket,
  canDeleteTickets,
  canEditTickets,
  canPerformTickets,
  canAdministrateTickets,
} = require("../middleware/permissions");

const fileUpload = require("../middleware/fileUpload");

router.get("/tickets/all-opened", isAuth, ticketController.getAllOpened);
router.get(
  "/tickets/recently-closed",
  isAuth,
  ticketController.getRecentlyClosed,
);
router.get("/tickets/user/:id", isAuth, ticketController.getUsersTickets);
router.post("/tickets/closed", isAuth, ticketController.getClosed);
router.get("/tickets/form-data", isAuth, ticketController.getFormData);

router.post(
  "/tickets/add",
  isAuth,
  fileUpload.array("attachments"),
  ticketController.add,
);
router.post(
  "/tickets/update",
  isAuth,
  canEditTickets,
  fileUpload.array("attachments"),
  ticketController.update,
);
router.post(
  "/tickets/process",
  isAuth,
  canAdministrateTickets,
  ticketController.process,
);
router.post(
  "/tickets/take-to-work",
  isAuth,
  canPerformTickets,
  ticketController.takeToWork,
);
router.post(
  "/tickets/request-help",
  isAuth,
  canPerformTickets,
  ticketController.requestHelp,
);
router.post(
  "/tickets/join-responsibles",
  isAuth,
  canPerformTickets,
  ticketController.joinResponsibles,
);
router.post(
  "/tickets/update-deadline",
  isAuth,
  canPerformTickets,
  ticketController.updateDeadline,
);
router.post(
  "/tickets/reject",
  isAuth,
  canPerformTickets,
  ticketController.reject,
);
router.post(
  "/tickets/close",
  isAuth,
  canPerformTickets,
  ticketController.close,
);
router.post("/tickets/back-to-work", isAuth, ticketController.backToWork);

router.post(
  "/tickets/delete/:id",
  isAuth,
  canDeleteTickets,
  ticketController.delete,
);

router.post(
  "/tickets/delete-multiple",
  isAuth,
  canDeleteTickets,
  ticketController.deleteMultiple,
);

router.post(
  "/tickets/:ticketNum/update-checklist",
  isAuth,
  canPerformTickets,
  ticketController.updateChecklist,
);

router.post(
  "/tickets/:ticketNum/update-checklist-item",
  isAuth,
  canPerformTickets,
  ticketController.updateChecklistItem,
);

router.get(
  "/tickets/:ticketNum",
  isAuth,
  allowedToViewTicket,
  ticketController.getOne,
);

// routes for telegram bot
/* router.post(
  "/tg/tickets/add",
  fileUpload.single("image"),
  isTelegramBot,
  ticketController.addTicketFromTelegram,
); */

router.get(
  "/tg/tickets/all-opened",
  isTelegramBot,
  ticketController.getAllOpenedTg,
);

module.exports = router;
