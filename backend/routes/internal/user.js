const Router = require("express");
const router = new Router();
const userController = require("@/controllers/user");
const impersonationController = require("@/controllers/impersonation");

const isAuth = require("@/middleware/isAuth");
const {
  canReadUsers,
  canManageUsers,
  canManageUserAccess,
  canManageKnowledge,
  canManageIntegrations,
  selfOrCanManageUsers,
  canImpersonateUsers,
  canManageSchedules,
  isNotClient,
} = require("@/middleware/permissions");

const { runValidation } = require("@/middleware/runValidation");
const teamValidation = require("@/validations/team");

const fileUpload = require("@/middleware/fileUpload");
const { uploadBackgroundImage } = require("@/middleware/imageUpload");
const isTelegramBot = require("@/middleware/isTelegramBot");

router.get("/users", isAuth, canReadUsers, userController.getAll);
// Остаётся доступным клиенту НАМЕРЕННО: загрузчик карточки заявки тянет этот
// список безусловно (`pages/Ticket/View.jsx:719`), а свою заявку открывает и
// клиент. Отдаются имена сотрудников поддержки — тех же, кого клиент видит в
// строке «ответственные» своей заявки.
router.get(
  "/users/can-perform-tickets",
  isAuth,
  userController.getCanPerformTicketsUsers,
);
router.get(
  "/users/knowledge-base-moderators",
  isAuth,
  canManageKnowledge,
  userController.getKnowledgeBaseModerators,
);
// PRO32 Connect: подключённые пользователи и отзыв доступа (глобальные
// настройки → «Интеграции»). Объявлены ДО wildcard /users/:id
router.get(
  "/users/pro32-connected",
  isAuth,
  canManageIntegrations,
  userController.getPro32Connected,
);
router.post(
  "/users/pro32-revoke/:id",
  isAuth,
  canManageIntegrations,
  userController.revokePro32,
);
// Компании для фасета списка «Пользователи» (скоуп как у getAll)
router.get(
  "/users/companies",
  isAuth,
  canReadUsers,
  userController.getScopeCompanies,
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

// Сеансы, второй фактор и пароли — это ДОСТУП, а не карточка человека, и право
// у них своё. Прежде их закрывало «управление пользователями», то есть тот, кому
// поручили вести профили, заодно мог сбросить пароль администратору.
router.get(
  "/users/:id/sessions",
  isAuth,
  canManageUserAccess,
  userController.sessions,
);
router.delete(
  "/users/:id/sessions/:sessionId",
  isAuth,
  canManageUserAccess,
  userController.revokeSession,
);
router.post(
  "/users/:id/sessions/revoke-all",
  isAuth,
  canManageUserAccess,
  userController.revokeAllSessions,
);

// Дополнительное условие («у сбрасывающего свой фактор тоже включён») проверяет
// контроллер: оно про самого вызывающего, а не про доступ к ручке.
router.post(
  "/users/:id/two-factor/reset",
  isAuth,
  canManageUserAccess,
  userController.resetTwoFactor,
);

// Вход под пользователем — СВОЁ право: вести учётки и ходить под ними разные
// вещи, и второе даётся точечно.
router.post(
  "/users/:id/impersonate",
  canImpersonateUsers,
  impersonationController.start,
);
router.post("/users/reset-password/:id", isAuth, userController.changePassword);
// Права — внутри контроллера, по той же причине, что и у смены пароля: «своё»
// и «чужое» здесь разные действия с разными основаниями.
router.post(
  "/users/send-password-link/:id",
  isAuth,
  userController.sendPasswordLink,
);
router.post(
  "/users/:id/add-profile-image",
  isAuth,
  selfOrCanManageUsers,
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

// График работы правится отдельным запросом с карточки сотрудника
router.post(
  "/users/:id/work-schedule",
  isAuth,
  canManageSchedules,
  teamValidation.updateWorkSchedule,
  runValidation,
  userController.updateWorkSchedule,
);
router.get("/users/:id", isAuth, userController.getOne);

module.exports = router;
