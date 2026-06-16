const Router = require("express");
const router = new Router();

const knowledgeNoteController = require("@/controllers/knowledgeNote");
const isAuth = require("@/middleware/isAuth");
const {
  isNotClient,
  canManageKnowledgeBase,
  canSeeKnowledgeBase,
} = require("@/middleware/permissions");

// Чтение доступно сотрудникам с правом canSeeKnowledgeBase; скоупинг по видимости — в контроллере
router.get(
  "/knowledge-notes",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  knowledgeNoteController.getAll,
);

// form-data объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/form-data",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.getFormData,
);

// related объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/related",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  knowledgeNoteController.getRelated,
);

// moderation-summary объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/moderation-summary",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  knowledgeNoteController.getModerationSummary,
);

router.get(
  "/knowledge-notes/:id",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  knowledgeNoteController.getOne,
);

router.post(
  "/knowledge-notes/add",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.add,
);

router.post(
  "/knowledge-notes/update/:id",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.update,
);

// Одобрение заметки — canManageKnowledgeBase + проверка модератора в контроллере
router.post(
  "/knowledge-notes/approve/:id",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.approve,
);

// Отправка на удаление (мягко) — носители canManageKnowledgeBase
router.post(
  "/knowledge-notes/send-to-deletion/:id",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.sendToDeletion,
);

// Подтверждение удаления (прун из БД) — проверка модератора в контроллере
router.post(
  "/knowledge-notes/confirm-deletion/:id",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.confirmDeletion,
);

// Пометить находку секрета как «не секрет» — проверка модератора в контроллере
router.post(
  "/knowledge-notes/:id/ignore-secret",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.ignoreSecretFinding,
);

router.post(
  "/knowledge-notes/delete/:id",
  isAuth,
  isNotClient,
  canSeeKnowledgeBase,
  canManageKnowledgeBase,
  knowledgeNoteController.delete,
);

module.exports = router;
