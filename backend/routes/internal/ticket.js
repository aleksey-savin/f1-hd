const Router = require("express");
const router = new Router();
const ticketController = require("@/controllers/ticket");
const isAuth = require("@/middleware/isAuth");
const isTelegramBot = require("@/middleware/isTelegramBot");
const {
  allowedToViewTicket,
  canDeleteTickets,
  canEditTickets,
  canPerformTickets,
  canAdministrateTickets,
  canManageKnowledgeBase,
  canSeeKnowledgeBase,
  knowledgeBaseModuleIsActive,
} = require("@/middleware/permissions");

const fileUpload = require("@/middleware/fileUpload");

router.get("/tickets/all-opened", isAuth, ticketController.getAllOpened);
router.get("/tickets/user/:id", isAuth, ticketController.getUsersTickets);
router.get("/tickets/closed", isAuth, ticketController.getClosed);
router.get("/tickets/form-data", isAuth, ticketController.getFormData);
// Раскрытие свёрнутой группы служебных записей в хронике
router.get(
  "/tickets/:ticketNum/log",
  isAuth,
  ticketController.getTechnicalLog,
);

router.post(
  "/tickets/add",
  isAuth,
  fileUpload.array("attachments"),
  ticketController.add,
);
router.post(
  "/tickets/:ticketNum/add-attachments",
  isAuth,
  canAdministrateTickets,
  fileUpload.array("attachments"),
  ticketController.addAttachments,
);
router.post(
  "/tickets/:ticketNum/remove-attachment",
  isAuth,
  canAdministrateTickets,
  ticketController.removeAttachment,
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
  "/tickets/ai-guide/generate",
  isAuth,
  canPerformTickets,
  ticketController.regenerateAiGuide,
);

// Понятийный аппарат заявки: разбор и справка по понятию — по требованию
router.post(
  "/tickets/ai-terms/analyze",
  isAuth,
  canPerformTickets,
  ticketController.analyzeAiTerms,
);
router.post(
  "/tickets/ai-terms/reference",
  isAuth,
  canPerformTickets,
  ticketController.getAiTermReference,
);
// Заводит заметку — значит, и права те же, что у формы базы знаний
router.post(
  "/tickets/ai-terms/save-note",
  isAuth,
  canPerformTickets,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  ticketController.saveAiTermNote,
);
// Замечание к тому, что ИИ вписал в заявку вместо человека
router.post(
  "/tickets/ai-feedback",
  isAuth,
  canPerformTickets,
  ticketController.addAiFeedback,
);
router.post(
  "/tickets/:ticketNum/attachments/speech-to-text",
  isAuth,
  canPerformTickets,
  ticketController.transcribeAttachment,
);

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
  "/tickets/take-to-work-multiple",
  isAuth,
  canPerformTickets,
  ticketController.takeToWorkMultiple,
);

router.post(
  "/tickets/close-multiple",
  isAuth,
  canPerformTickets,
  ticketController.closeMultiple,
);

// Состав чек-листа — правка заявки (карандаш секции), а отметка пункта —
// её выполнение, поэтому права разные
router.post(
  "/tickets/:ticketNum/update-checklist",
  isAuth,
  canEditTickets,
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
