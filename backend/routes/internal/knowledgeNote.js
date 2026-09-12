const Router = require("express");
const router = new Router();

const knowledgeNoteController = require("@/controllers/knowledgeNote");
const isAuth = require("@/middleware/isAuth");
const {
  isNotClient,
  canManageKnowledge,
  canModerateKnowledge,
  canReadKnowledge,
  knowledgeBaseModuleIsActive,
} = require("@/middleware/permissions");

// Чтение доступно сотрудникам с правом canReadKnowledge; скоупинг по видимости — в контроллере
router.get(
  "/knowledge-notes",
  isAuth,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  knowledgeNoteController.getAll,
);

// form-data объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/form-data",
  isAuth,
  knowledgeBaseModuleIsActive,
  isNotClient,
  canReadKnowledge,
  canManageKnowledge,
  knowledgeNoteController.getFormData,
);

// related объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/related",
  isAuth,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  knowledgeNoteController.getRelated,
);

// moderation-summary объявляется до :id, чтобы не быть перехваченным динамическим сегментом.
//
// БЕЗ canModerateKnowledge — намеренно: карточка модерации на странице заявок и
// панель фильтров дергают эту ручку для ВСЕХ, у кого есть canReadKnowledge, и
// ждут в ответ ноль-сводку `{isModerator:false,...ZERO_COUNTS}`, а не 403.
// Право `knowledge.moderate` решается внутри контроллера (getModerationSummary).
router.get(
  "/knowledge-notes/moderation-summary",
  isAuth,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  knowledgeNoteController.getModerationSummary,
);

// service-expiry объявляется до :id, чтобы не быть перехваченным динамическим сегментом.
//
// БЕЗ canReadKnowledge — намеренно, это единственный маршрут раздела без него.
// Сроки продления адресованы и ответственному со стороны клиента, а он этого
// права может не иметь вовсе: `knowledge.read` адресован ОБОИМ (словарь,
// audience `both`), но клиенту он открывает заметки его компании, и раздавать
// его каждому ответственному ради строки со сроком незачем.
// Ручка отдаёт не заметки, а строки сроков, и решает, кому что показать, сама
// (см. getServiceExpiry) — сотрудник по правилам базы знаний, клиент-ответственный
// только по своей компании, остальные не получают ничего.
router.get(
  "/knowledge-notes/service-expiry",
  isAuth,
  knowledgeBaseModuleIsActive,
  knowledgeNoteController.getServiceExpiry,
);

router.get(
  "/knowledge-notes/:id",
  isAuth,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  knowledgeNoteController.getOne,
);

router.post(
  "/knowledge-notes/add",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canManageKnowledge,
  knowledgeNoteController.add,
);

router.post(
  "/knowledge-notes/update/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canManageKnowledge,
  knowledgeNoteController.update,
);

// Массовые действия модерации. Литеральные пути объявляем до динамических
// маршрутов вида /approve/:id — иначе `:id` перехватит `-multiple`.
// Гарды те же, что у одиночных близнецов; право `knowledge.moderate`.
const moderationBulkRoutes = [
  ["approve-multiple", knowledgeNoteController.approveMultiple],
  ["confirm-deletion-multiple", knowledgeNoteController.confirmDeletionMultiple],
  ["decline-deletion-multiple", knowledgeNoteController.declineDeletionMultiple],
  ["confirm-archive-multiple", knowledgeNoteController.confirmArchiveMultiple],
  ["decline-archive-multiple", knowledgeNoteController.declineArchiveMultiple],
];

moderationBulkRoutes.forEach(([path, handler]) => {
  router.post(
    `/knowledge-notes/${path}`,
    isAuth,
    isNotClient,
    knowledgeBaseModuleIsActive,
    canReadKnowledge,
    canModerateKnowledge,
    handler,
  );
});

// Отметка «Проверено» — право `knowledge.moderate`
router.post(
  "/knowledge-notes/approve/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canModerateKnowledge,
  knowledgeNoteController.approve,
);

// Отправка на удаление (мягко) — носители canManageKnowledge
router.post(
  "/knowledge-notes/send-to-deletion/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canManageKnowledge,
  knowledgeNoteController.sendToDeletion,
);

// Подтверждение удаления (прун из БД) — право `knowledge.moderate`
router.post(
  "/knowledge-notes/confirm-deletion/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canModerateKnowledge,
  knowledgeNoteController.confirmDeletion,
);

// Отклонение запроса на удаление — право `knowledge.moderate`
router.post(
  "/knowledge-notes/decline-deletion/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canModerateKnowledge,
  knowledgeNoteController.declineDeletion,
);

// Запрос на архивацию (мягко) — носители canManageKnowledge
router.post(
  "/knowledge-notes/request-archive/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canManageKnowledge,
  knowledgeNoteController.requestArchive,
);

// Подтверждение архивации — право `knowledge.moderate`
router.post(
  "/knowledge-notes/confirm-archive/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canModerateKnowledge,
  knowledgeNoteController.confirmArchive,
);

// Отклонение запроса на архивацию — право `knowledge.moderate`
router.post(
  "/knowledge-notes/decline-archive/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canModerateKnowledge,
  knowledgeNoteController.declineArchive,
);

// Восстановление из архива — носители canManageKnowledge
router.post(
  "/knowledge-notes/unarchive/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canManageKnowledge,
  knowledgeNoteController.unarchive,
);

// Пометить находку секрета как «не секрет» — право `knowledge.moderate`
router.post(
  "/knowledge-notes/:id/ignore-secret",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canModerateKnowledge,
  knowledgeNoteController.ignoreSecretFinding,
);

router.post(
  "/knowledge-notes/delete/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canReadKnowledge,
  canManageKnowledge,
  knowledgeNoteController.delete,
);

module.exports = router;
