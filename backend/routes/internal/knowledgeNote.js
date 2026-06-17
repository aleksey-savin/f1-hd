const Router = require("express");
const router = new Router();

const knowledgeNoteController = require("@/controllers/knowledgeNote");
const isAuth = require("@/middleware/isAuth");
const {
  isNotClient,
  canManageKnowledgeBase,
  canSeeKnowledgeBase,
  knowledgeBaseModuleIsActive,
} = require("@/middleware/permissions");

// Чтение доступно сотрудникам с правом canSeeKnowledgeBase; скоупинг по видимости — в контроллере
router.get(
  "/knowledge-notes",
  isAuth,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  knowledgeNoteController.getAll,
);

// form-data объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/form-data",
  isAuth,
  knowledgeBaseModuleIsActive,
  isNotClient,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.getFormData,
);

// related объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/related",
  isAuth,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  knowledgeNoteController.getRelated,
);

// moderation-summary объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/moderation-summary",
  isAuth,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  knowledgeNoteController.getModerationSummary,
);

// service-expiry объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/service-expiry",
  isAuth,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  knowledgeNoteController.getServiceExpiry,
);

router.get(
  "/knowledge-notes/:id",
  isAuth,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  knowledgeNoteController.getOne,
);

router.post(
  "/knowledge-notes/add",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.add,
);

router.post(
  "/knowledge-notes/update/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.update,
);

// Одобрение заметки — canManageKnowledgeBase + проверка модератора в контроллере
router.post(
  "/knowledge-notes/approve/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.approve,
);

// Отправка на удаление (мягко) — носители canManageKnowledgeBase
router.post(
  "/knowledge-notes/send-to-deletion/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.sendToDeletion,
);

// Подтверждение удаления (прун из БД) — проверка модератора в контроллере
router.post(
  "/knowledge-notes/confirm-deletion/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.confirmDeletion,
);

// Отклонение запроса на удаление — проверка модератора в контроллере
router.post(
  "/knowledge-notes/decline-deletion/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.declineDeletion,
);

// Запрос на архивацию (мягко) — носители canManageKnowledgeBase
router.post(
  "/knowledge-notes/request-archive/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.requestArchive,
);

// Подтверждение архивации — проверка модератора в контроллере
router.post(
  "/knowledge-notes/confirm-archive/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.confirmArchive,
);

// Отклонение запроса на архивацию — проверка модератора в контроллере
router.post(
  "/knowledge-notes/decline-archive/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.declineArchive,
);

// Восстановление из архива — носители canManageKnowledgeBase
router.post(
  "/knowledge-notes/unarchive/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.unarchive,
);

// Пометить находку секрета как «не секрет» — проверка модератора в контроллере
router.post(
  "/knowledge-notes/:id/ignore-secret",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.ignoreSecretFinding,
);

router.post(
  "/knowledge-notes/delete/:id",
  isAuth,
  isNotClient,
  knowledgeBaseModuleIsActive,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.delete,
);

module.exports = router;
