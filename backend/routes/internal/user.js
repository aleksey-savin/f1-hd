const Router = require("express");
const router = new Router();
const userController = require("@/controllers/user");

const isAuth = require("@/middleware/isAuth");
const {
  canManageUsers,
  canManageWorkSchedules,
  isNotClient,
  isAdmin,
} = require("@/middleware/permissions");

const { runValidation } = require("@/middleware/runValidation");
const teamValidation = require("@/validations/team");

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
// PRO32 Connect: подключённые пользователи и отзыв доступа (глобальные
// настройки → «Интеграции»). Объявлены ДО wildcard /users/:id
router.get(
  "/users/pro32-connected",
  isAuth,
  isAdmin,
  userController.getPro32Connected,
);
router.post(
  "/users/pro32-revoke/:id",
  isAuth,
  isAdmin,
  userController.revokePro32,
);
// Компании для фасета списка «Пользователи» (скоуп как у getAll)
router.get(
  "/users/companies",
  isAuth,
  isNotClient,
  userController.getScopeCompanies,
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

// График работы — секция той же формы: блок `workSchedule` валидируется теми
// же правилами, что и отдельный endpoint графика, и применяется только с
// правом на графики (проверка — в контроллере, как у финансов)
router.post(
  "/users/add",
  isAuth,
  canManageUsers,
  teamValidation.workScheduleBlock,
  runValidation,
  userController.add,
);
router.post(
  "/users/update/:id",
  isAuth,
  canManageUsers,
  teamValidation.workScheduleBlock,
  runValidation,
  userController.update,
);
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
// График работы правится отдельным запросом с карточки сотрудника
router.post(
  "/users/:id/work-schedule",
  isAuth,
  canManageWorkSchedules,
  teamValidation.updateWorkSchedule,
  runValidation,
  userController.updateWorkSchedule,
);
router.get("/users/:id", isAuth, userController.getOne);

module.exports = router;
