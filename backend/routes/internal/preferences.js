const Router = require("express");
const rateLimit = require("express-rate-limit");
const router = new Router();
const preferencesController = require("@/controllers/preferences");
const preferencesValidation = require("@/validations/preferences");
const isAuth = require("@/middleware/isAuth");
const {
  canReadSettings,
  canManageSettings,
  canManageMailSettings,
  canManageIntegrations,
} = require("@/middleware/permissions");
const { uploadCompanyLogo } = require("@/middleware/imageUpload");
const { checkValidationResult } = require("@/middleware/validation");

// Проверки ходят во внешнюю сеть по адресу и ключу из тела запроса, отправляют
// почту и тратят токены ИИ — ограничиваем частоту даже для админа (образец —
// роуты параметров Mikrotik).
const checkLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: true,
    message: "Слишком много проверок подряд — попробуйте через несколько минут",
  },
});

router.get("/preferences", isAuth, canReadSettings, preferencesController.get);
router.get("/preferences-initial", isAuth, preferencesController.getInitial);
router.get("/preferences-auth", preferencesController.getAuth);
// Право на КАЖДУЮ присланную секцию проверяет контроллер
// (`sectionsBeyondRights`): ручка одна, а настройки в ней разного веса.
router.post(
  "/preferences",
  isAuth,
  canReadSettings,
  preferencesValidation.update,
  checkValidationResult,
  preferencesController.update,
);
router.post(
  "/preferences/logo",
  isAuth,
  canManageSettings,
  // Локальный diskStorage: лого читается на каждой странице каждым пользователем
  uploadCompanyLogo,
  preferencesController.uploadLogo,
);
router.post(
  "/preferences/delete-logo",
  isAuth,
  canManageSettings,
  preferencesController.deleteLogo,
);
router.post(
  "/preferences/ai-models",
  isAuth,
  canManageIntegrations,
  checkLimiter,
  preferencesController.getAiModels,
);
router.post(
  "/preferences/ai/check",
  isAuth,
  canManageIntegrations,
  checkLimiter,
  preferencesController.checkAi,
);
router.post(
  "/preferences/ai/speech-check",
  isAuth,
  canManageIntegrations,
  checkLimiter,
  preferencesController.checkSpeechToText,
);
// Правила ИИ — замечания сотрудников, включает их администратор
router.get(
  "/preferences/ai-rules",
  isAuth,
  canManageIntegrations,
  preferencesController.getAiRules,
);
router.post(
  "/preferences/ai-rules/toggle",
  isAuth,
  canManageIntegrations,
  preferencesController.toggleAiRule,
);
router.post(
  "/preferences/ai-rules/delete",
  isAuth,
  canManageIntegrations,
  preferencesController.deleteAiRule,
);
router.post(
  "/preferences/mailbox/check",
  isAuth,
  canManageMailSettings,
  checkLimiter,
  preferencesController.checkMailbox,
);
router.post(
  "/preferences/smtp/test",
  isAuth,
  canManageMailSettings,
  checkLimiter,
  preferencesController.sendTestEmail,
);
module.exports = router;
