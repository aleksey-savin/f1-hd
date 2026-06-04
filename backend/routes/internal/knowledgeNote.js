const Router = require("express");
const router = new Router();

const knowledgeNoteController = require("@/controllers/knowledgeNote");
const isAuth = require("@/middleware/isAuth");
const { isNotClient, canManageKnowledgeBase } = require("@/middleware/permissions");

// Чтение доступно любому сотруднику (не клиенту); скоупинг по видимости — в контроллере
router.get("/knowledge-notes", isAuth, isNotClient, knowledgeNoteController.getAll);

// form-data объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/form-data",
  isAuth,
  isNotClient,
  canManageKnowledgeBase,
  knowledgeNoteController.getFormData,
);

// related объявляется до :id, чтобы не быть перехваченным динамическим сегментом
router.get(
  "/knowledge-notes/related",
  isAuth,
  isNotClient,
  knowledgeNoteController.getRelated,
);

router.get(
  "/knowledge-notes/:id",
  isAuth,
  isNotClient,
  knowledgeNoteController.getOne,
);

router.post(
  "/knowledge-notes/add",
  isAuth,
  isNotClient,
  canManageKnowledgeBase,
  knowledgeNoteController.add,
);

router.post(
  "/knowledge-notes/update/:id",
  isAuth,
  isNotClient,
  canManageKnowledgeBase,
  knowledgeNoteController.update,
);

router.post(
  "/knowledge-notes/delete/:id",
  isAuth,
  isNotClient,
  canManageKnowledgeBase,
  knowledgeNoteController.delete,
);

module.exports = router;
