const Router = require("express");
const router = new Router();
const ticketController = require("@/controllers/ticket");
const notificationController = require("@/controllers/notification");
const notificationValidation = require("@/validations/notification");
const { runValidation } = require("@/middleware/runValidation");
const isAuth = require("@/middleware/isAuth");
const isTelegramBot = require("@/middleware/isTelegramBot");
const {
  allowedToViewTicket,
  requireTicketAccess,
  requireTicketsAccess,
  canDeleteTickets,
  canPerformTickets,
  canManageTickets,
  canReturnTicket,
  requireOwnTicketOrManage,
  requireOwnTicketsOrManage,
  requireJoinable,
  requireJoinableTickets,
  canManageKnowledge,
  canReadKnowledge,
  knowledgeBaseModuleIsActive,
} = require("@/middleware/permissions");

const { aiFeatureIsActive } = require("@/middleware/modules");
const fileUpload = require("@/middleware/fileUpload");

const byBodyId = requireTicketAccess((req) => ({ id: req.body._id }));
const byNum = requireTicketAccess((req) => ({ num: req.params.ticketNum }));
const byBodyIds = requireTicketsAccess((req) => req.body.ids);

router.get("/tickets/all-opened", isAuth, ticketController.getAllOpened);
router.get("/tickets/user/:id", isAuth, ticketController.getUsersTickets);
router.get("/tickets/closed", isAuth, ticketController.getClosed);
router.get("/tickets/form-data", isAuth, ticketController.getFormData);
// Раскрытие свёрнутой группы служебных записей в хронике
router.get(
  "/tickets/:ticketNum/log",
  allowedToViewTicket,
  ticketController.getTechnicalLog,
);

router.post("/tickets/add", isAuth, fileUpload.array("attachments"), ticketController.add);
// Вложения самой заявки — содержание заявки: только «Вести заявки».
// Исполнитель и клиент прикладывают файлы через комментарии.
router.post("/tickets/:ticketNum/add-attachments", isAuth, canManageTickets, byNum, fileUpload.array("attachments"), ticketController.addAttachments);
router.post("/tickets/:ticketNum/remove-attachment", isAuth, canManageTickets, byNum, ticketController.removeAttachment);
// Мультипарт: `_id` появляется в теле только после multer, поэтому проверка доступа стоит за ним
router.post("/tickets/update", isAuth, canManageTickets, fileUpload.array("attachments"), byBodyId, ticketController.update);
router.post("/tickets/process", isAuth, canManageTickets, byBodyId, ticketController.process);
// Принять в работу и присоединиться — `requireJoinable`: свою заявку берёт
// ответственный, чужую — только с правом «Присоединяться к чужим заявкам»
// (гейты стоят после проверки доступа: читают req.ticket)
router.post("/tickets/take-to-work", isAuth, canPerformTickets, byBodyId, requireJoinable, ticketController.takeToWork);
router.post("/tickets/request-help", isAuth, canPerformTickets, byBodyId, requireOwnTicketOrManage, ticketController.requestHelp);
router.post("/tickets/join-responsibles", isAuth, canPerformTickets, byBodyId, requireJoinable, ticketController.joinResponsibles);
router.post("/tickets/update-deadline", isAuth, canPerformTickets, byBodyId, requireOwnTicketOrManage, ticketController.updateDeadline);
router.post("/tickets/reject", isAuth, canPerformTickets, byBodyId, requireOwnTicketOrManage, ticketController.reject);
// Закрыть, отказаться, изменить срок, запросить помощь, отметить пункт —
// только на своей заявке (`requireOwnTicketOrManage`): до сих пор исполнителю
// хватало одного «Брать заявки в работу» на любую доступную заявку
router.post("/tickets/close", isAuth, canPerformTickets, byBodyId, requireOwnTicketOrManage, ticketController.close);
// Вернуть в работу может исполнитель — и САМ заявитель своей закрытой заявки
// (`canReturnTicket`, стоит после проверки доступа: читает req.ticket)
router.post("/tickets/back-to-work", isAuth, byBodyId, canReturnTicket, ticketController.backToWork);
// Функции ИИ включаются по одной (Настройки → ИИ → «Функции»): выключенная
// отказывает до того, как ручка пометит заявку «ожидает ИИ»
router.post("/tickets/ai-guide/generate", isAuth, canPerformTickets, aiFeatureIsActive("guide"), byBodyId, ticketController.regenerateAiGuide);
router.post("/tickets/ai-terms/analyze", isAuth, canPerformTickets, aiFeatureIsActive("terms"), byBodyId, ticketController.analyzeAiTerms);
router.post("/tickets/ai-terms/reference", isAuth, canPerformTickets, aiFeatureIsActive("terms"), byBodyId, ticketController.getAiTermReference);
router.post("/tickets/ai-terms/save-note", isAuth, canPerformTickets, aiFeatureIsActive("terms"), byBodyId, knowledgeBaseModuleIsActive, canReadKnowledge, canManageKnowledge, ticketController.saveAiTermNote);
router.post("/tickets/ai-feedback", isAuth, canPerformTickets, aiFeatureIsActive("feedback"), byBodyId, ticketController.addAiFeedback);
router.post("/tickets/:ticketNum/attachments/speech-to-text", isAuth, canPerformTickets, aiFeatureIsActive("speechToText"), byNum, ticketController.transcribeAttachment);
router.post("/tickets/delete/:id", isAuth, canDeleteTickets, requireTicketAccess((req) => ({ id: req.params.id })), ticketController.delete);
router.post("/tickets/delete-multiple", isAuth, canDeleteTickets, byBodyIds, ticketController.deleteMultiple);
router.post("/tickets/take-to-work-multiple", isAuth, canPerformTickets, byBodyIds, requireJoinableTickets, ticketController.takeToWorkMultiple);
router.post("/tickets/close-multiple", isAuth, canPerformTickets, byBodyIds, requireOwnTicketsOrManage, ticketController.closeMultiple);
// «Отметить прочитанными» из очереди «Непрочитанные»: водяной знак «видел» на
// список заявок — только доступных (byBodyIds)
router.post("/tickets/seen", isAuth, notificationValidation.seenMany, runValidation, byBodyIds, notificationController.markTicketsSeen);
// Состав чек-листа: право решает контроллер (canEditChecklist) — оно зависит
// от отношения к заявке и от того, регламентная ли она
router.post("/tickets/:ticketNum/update-checklist", isAuth, byNum, ticketController.updateChecklist);
router.post("/tickets/:ticketNum/update-checklist-item", isAuth, canPerformTickets, byNum, requireOwnTicketOrManage, ticketController.updateChecklistItem);

// Заявку открыли: водяной знак «видел» и её уведомления в колокольчике прочитаны
router.post("/tickets/:ticketNum/seen", isAuth, byNum, notificationController.markTicketSeen);

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
