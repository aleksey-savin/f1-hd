const Router = require("express");
const rateLimit = require("express-rate-limit");
const router = new Router();
const preferencesController = require("@/controllers/preferences");
const preferencesValidation = require("@/validations/preferences");
const mcpKeyController = require("@/controllers/mcpKey");
const mcpKeyValidation = require("@/validations/mcpKey");
const isAuth = require("@/middleware/isAuth");
const { canManageSettings } = require("@/middleware/permissions");
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

router.get("/preferences", isAuth, canManageSettings, preferencesController.get);
router.get("/preferences-initial", isAuth, preferencesController.getInitial);
router.get("/preferences-auth", preferencesController.getAuth);
// Настройки — одно право: секции по правам не делятся (спека 2026-09-11).
router.post(
  "/preferences",
  isAuth,
  canManageSettings,
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
  canManageSettings,
  checkLimiter,
  preferencesController.getAiModels,
);
router.post(
  "/preferences/ai/check",
  isAuth,
  canManageSettings,
  checkLimiter,
  preferencesController.checkAi,
);
router.post(
  "/preferences/ai/speech-check",
  isAuth,
  canManageSettings,
  checkLimiter,
  preferencesController.checkSpeechToText,
);
// Правила ИИ — замечания сотрудников, включает их администратор
router.get(
  "/preferences/ai-rules",
  isAuth,
  canManageSettings,
  preferencesController.getAiRules,
);
router.post(
  "/preferences/ai-rules/toggle",
  isAuth,
  canManageSettings,
  preferencesController.toggleAiRule,
);
router.post(
  "/preferences/ai-rules/delete",
  isAuth,
  canManageSettings,
  preferencesController.deleteAiRule,
);
// Ключи ИИ-агентов к базе знаний по MCP (сама точка — routes/mcp.js)
router.get(
  "/preferences/mcp-keys",
  isAuth,
  canManageSettings,
  mcpKeyController.list,
);
router.post(
  "/preferences/mcp-keys",
  isAuth,
  canManageSettings,
  mcpKeyValidation.create,
  checkValidationResult,
  mcpKeyController.create,
);
router.post(
  "/preferences/mcp-keys/delete",
  isAuth,
  canManageSettings,
  mcpKeyValidation.remove,
  checkValidationResult,
  mcpKeyController.remove,
);
router.post(
  "/preferences/mcp-keys/update",
  isAuth,
  canManageSettings,
  mcpKeyValidation.update,
  checkValidationResult,
  mcpKeyController.update,
);
router.post(
  "/preferences/mailbox/check",
  isAuth,
  canManageSettings,
  checkLimiter,
  preferencesController.checkMailbox,
);
router.post(
  "/preferences/smtp/test",
  isAuth,
  canManageSettings,
  checkLimiter,
  preferencesController.sendTestEmail,
);
module.exports = router;
