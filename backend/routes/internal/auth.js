const express = require("express");
const rateLimit = require("express-rate-limit");
const { formatInTimeZone, getTimezoneOffset } = require("date-fns-tz");

const { DEFAULT_TIMEZONE } = require("@/utils/datetime");

const authController = require("@/controllers/auth");
const isTelegramBot = require("@/middleware/isTelegramBot");
const logger = require("@/utils/logger");

const { runValidation } = require("@/middleware/runValidation");
const authValidation = require("@/validations/auth");

const Preferences = require("@/models/preferences");

const router = express.Router();

async function formatResetTime(resetTimeMs) {
  // Таймзона приложения; смещение от Москвы считаем через date-fns-tz (вместо
  // рукописной таблицы и хрупкого toLocaleString-раунд-трипа).
  let timezone = DEFAULT_TIMEZONE;
  let mskOffset = 0; // Default offset from Moscow

  try {
    const preferences = await Preferences.findOne({});
    if (preferences?.timezone) {
      timezone = preferences.timezone;
      const now = new Date();
      mskOffset = Math.round(
        (getTimezoneOffset(timezone, now) -
          getTimezoneOffset("Europe/Moscow", now)) /
          (1000 * 60 * 60),
      );
    }
  } catch (err) {
    logger.logDirect("warn", "Failed to fetch timezone from preferences", {
      error: err.message,
    });
  }

  const resetDate = new Date(resetTimeMs);

  // Format the time in the selected timezone
  const timeString = formatInTimeZone(resetDate, timezone, "HH:mm");

  // Add MSK offset notation
  let offsetString = "МСК";
  if (mskOffset !== 0) {
    offsetString = `МСК ${mskOffset > 0 ? "+" : ""}${mskOffset}`;
  }

  // Return formatted time with MSK offset
  return `${timeString} (${offsetString})`;
}

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req, res, _next, options) => {
    const resetTime = Date.now() + options.windowMs;
    const formattedResetTime = await formatResetTime(resetTime, req);

    res.status(options.statusCode).json({
      error: true,
      message: `Слишком много попыток с этого IP. Пожалуйста, попробуйте снова после ${formattedResetTime}.`,
    });
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit to 10 login attempts per hour per IP+email combination
  standardHeaders: true,
  legacyHeaders: false,
  // Count attempts by IP + normalized email
  keyGenerator: (req) => {
    const email = (req.body.email || "").toLowerCase().trim();
    return `${req.ip}:${email}`;
  },
  // Log failed attempts
  handler: async (req, res, _next, options) => {
    const resetTime = Date.now() + options.windowMs;
    const formattedResetTime = await formatResetTime(resetTime, req);

    logger.logDirect("warn", "Too many login attempts", {
      ip: req.ip,
      email: req.body.email,
      attempts: 5,
      userAgent: req.headers["user-agent"],
      resetTime: new Date(resetTime).toISOString(),
    });

    res.status(options.statusCode).json({
      error: true,
      message: `Слишком много попыток входа. Ваш аккаунт временно заблокирован. Попробуйте снова после ${formattedResetTime}`,
      locked: true,
      resetTime: formattedResetTime,
    });
  },
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
});


/**
 * Ссылка для входа: свой лимитер по АДРЕСУ, а не только по IP.
 *
 * Без него ручка становится инструментом рассылки писем на чужой ящик: адрес
 * чужой, IP свой, и общий лимитер по IP тут не помогает — он ограничит
 * отправителя, а достаётся получателю. Три письма в час на адрес — потолок
 * осмысленного: ссылка живёт полчаса, и четвёртая за час означает не спешку,
 * а чужие руки.
 */
const loginLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.body?.email || "").toLowerCase().trim(),
  // Ответ ТОТ ЖЕ, что у успеха: разный ответ на «часто просят» и «адреса
  // нет» опять сделал бы из ручки проверялку чужих адресов.
  handler: (req, res) =>
    res.status(200).json({
      message: "Если такой адрес есть, письмо со ссылкой отправлено.",
    }),
});

// Саморегистрация (`/signup`, `/signup/company-by-email`) и первый запуск
// (`/first-launch`) удалены: учётки заводит ИТ-отдел вместе с AD и почтой, а
// три неавторизованных эндпоинта — лишняя поверхность (один из них уже был
// дырой в проде). Первый запуск делает сид при старте.
//
// Восстановление пароля (`/forgot-password`, `/reset-password`,
// `/validate-reset-token/:token`) переехало на ручки better-auth
// `/api/auth/request-password-reset` и `/api/auth/reset-password`. Вместе с
// ним ушла механика `resetToken` + sha256 и хранение сырого токена в
// `user.notifications` — источник дыры, а не только она сама.
router.post(
  "/login",
  authLimiter,
  loginLimiter,
  authValidation.login,
  runValidation,
  authController.login,
);

// Вход по ссылке из письма — только клиентам; гейт и одинаковый ответ на
// любой адрес живут в контроллере.
router.post(
  "/login-link",
  authLimiter,
  loginLinkLimiter,
  authController.requestLoginLink,
);

// routes for telegram bot
router.post("/tg/auth", isTelegramBot, authController.authTelegram);

module.exports = router;
