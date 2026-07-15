const Router = require("express");
const router = new Router();
const userController = require("@/controllers/user");

const isAuth = require("@/middleware/isAuth");
const {
  canManageUsers,
  isNotClient,
  isAdmin,
} = require("@/middleware/permissions");

const fileUpload = require("@/middleware/fileUpload");
const { uploadBackgroundImage } = require("@/middleware/imageUpload");
const isTelegramBot = require("@/middleware/isTelegramBot");

router.get("/users", isAuth, isNotClient, userController.getAll);
router.get("/auth-data", isAuth, userController.getAuthed);
router.get(
  "/users/can-perform-tickets",
  isAuth,
  userController.getCanPerformTicketsUsers,
);
router.get(
  "/users/with-workplaces",
  isAuth,
  userController.getUsersWithWorkplaces,
);
router.get(
  "/users/knowledge-base-moderators",
  isAuth,
  isAdmin,
  userController.getKnowledgeBaseModerators,
);
router.post(
  "/users/create-workplaces",
  isAuth,
  canManageUsers,
  userController.createWorkplacesForExistingUsers,
);

// Статусы присутствия: лёгкий список для бара + смена своего статуса
router.get(
  "/users/work-statuses",
  isAuth,
  isNotClient,
  userController.getWorkStatuses,
);
router.post(
  "/users/set-status",
  isAuth,
  isNotClient,
  userController.setWorkStatus,
);
// Для telegram-бота (прецедент /tg/auth): тап по кнопке под табло статусов
router.post(
  "/tg/set-work-status",
  isTelegramBot,
  userController.setWorkStatusFromTelegram,
);

router.post("/users/add", isAuth, canManageUsers, userController.add);
router.post("/users/update/:id", isAuth, canManageUsers, userController.update);
router.post("/users/update-account", isAuth, userController.updateMyAccount);
router.post("/users/delete/:id", isAuth, canManageUsers, userController.delete);
router.post(
  "/users/toggle-active/:id",
  isAuth,
  canManageUsers,
  userController.toggleActive,
);
router.post("/users/reset-password/:id", isAuth, userController.changePassword);
router.post(
  "/users/:id/add-profile-image",
  isAuth,
  fileUpload.single("profileImage"),
  userController.addProfileImage,
);
router.post(
  "/users/add-background-image",
  isAuth,
  // Локальный diskStorage, не S3: фон читается при каждой загрузке приложения
  uploadBackgroundImage,
  userController.addBackgroundImage,
);

router.post(
  "/users/delete-background-image",
  isAuth,
  userController.deleteBackgroundImage,
);

router.post(
  "/users/disable-changelog",
  isAuth,
  userController.disableChangelogNotification,
);
router.get("/users/:id", isAuth, userController.getOne);

module.exports = router;
