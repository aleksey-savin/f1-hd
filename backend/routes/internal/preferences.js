const Router = require("express");
const rateLimit = require("express-rate-limit");
const router = new Router();
const preferencesController = require("@/controllers/preferences");
const preferencesValidation = require("@/validations/preferences");
const isAuth = require("@/middleware/isAuth");
const { isAdmin } = require("@/middleware/permissions");
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

router.get("/preferences", isAuth, isAdmin, preferencesController.get);
router.get("/preferences-initial", isAuth, preferencesController.getInitial);
router.get("/preferences-auth", preferencesController.getAuth);
router.post(
  "/preferences",
  isAuth,
  isAdmin,
  preferencesValidation.update,
  checkValidationResult,
  preferencesController.update,
);
router.post(
  "/preferences/logo",
  isAuth,
  isAdmin,
  // Локальный diskStorage: лого читается на каждой странице каждым пользователем
  uploadCompanyLogo,
  preferencesController.uploadLogo,
);
router.post(
  "/preferences/delete-logo",
  isAuth,
  isAdmin,
  preferencesController.deleteLogo,
);
router.post(
  "/preferences/ai-models",
  isAuth,
  isAdmin,
  checkLimiter,
  preferencesController.getAiModels,
);
router.post(
  "/preferences/ai/check",
  isAuth,
  isAdmin,
  checkLimiter,
  preferencesController.checkAi,
);
router.post(
  "/preferences/ai/speech-check",
  isAuth,
  isAdmin,
  checkLimiter,
  preferencesController.checkSpeechToText,
);
router.post(
  "/preferences/mailbox/check",
  isAuth,
  isAdmin,
  checkLimiter,
  preferencesController.checkMailbox,
);
router.post(
  "/preferences/smtp/test",
  isAuth,
  isAdmin,
  checkLimiter,
  preferencesController.sendTestEmail,
);
module.exports = router;
