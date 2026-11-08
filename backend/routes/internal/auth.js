const express = require("express");
const rateLimit = require("express-rate-limit");
const { authRatePolicy, pairKey, accountKey, challengeKey, abuseIp, setAuthClientIp } = require("../../services/authRatePolicy");
const { formatInTimeZone, getTimezoneOffset } = require("date-fns-tz");

const { DEFAULT_TIMEZONE } = require("@/utils/datetime");

const authController = require("@/controllers/auth");
const impersonationController = require("@/controllers/impersonation");
const isTelegramBot = require("@/middleware/isTelegramBot");
const logger = require("@/utils/logger");

const { runValidation } = require("@/middleware/runValidation");
const authValidation = require("@/validations/auth");

const Preferences = require("@/models/preferences");

const { getAuth, getFromNodeHeaders } = require("../../auth/bootstrap");

const router = express.Router();
router.use(["/login", "/login-code"], setAuthClientIp);

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

const authLimiter = authRatePolicy.middleware({
  key: (req) => `ip:${abuseIp(req.ip)}`,
  windowMs: 60 * 60 * 1000, // 60 minutes
  limit: 50, // limit each IP to 50 requests per windowMs
  handler: async (req, res, _next, options) => {
    const resetTime = req.authRateLimit.resetAt;
    const formattedResetTime = await formatResetTime(resetTime, req);

    res.status(options.statusCode).json({
      error: true,
      message: `Слишком много попыток с этого IP. Пожалуйста, попробуйте снова после ${formattedResetTime}.`,
    });
  },
});

const loginLimiter = authRatePolicy.middleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // failed attempts per 15 minutes per IP+email
  // Count attempts by IP + normalized email
  key: (req) => pairKey("password", req.ip, req.body?.email),
  // Log failed attempts
  handler: async (req, res, _next, options) => {
    const resetTime = req.authRateLimit.resetAt;
    const formattedResetTime = await formatResetTime(resetTime, req);

    logger.logDirect("warn", "Too many login attempts", {
      ip: req.ip,
      email: req.body?.email,
      attempts: 10,
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
  failureOnly: true, // Don't count successful logins against the limit
});


/**
 * Код для входа: свой лимитер по АДРЕСУ, а не только по IP.
 *
 * Без него ручка становится инструментом рассылки писем на чужой ящик: адрес
 * чужой, IP свой, и общий лимитер по IP тут не помогает — он ограничит
 * отправителя, а достаётся получателю. Три письма в час на адрес — потолок
 * осмысленного: код живёт пятнадцать минут, и четвёртое письмо за час
 * означает не спешку, а чужие руки.
 */
const loginCodeLimiter = authRatePolicy.middleware({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  key: (req) => `issue:${accountKey(req.body?.email)}`,
  // Ответ ТОТ ЖЕ, что у успеха: разный ответ на «часто просят» и «адреса
  // нет» опять сделал бы из ручки проверялку чужих адресов.
  handler: (req, res) =>
    res.status(200).json({
      message: "Если такой адрес есть, код отправлен.",
    }),
});

/**
 * Проверка кода из письма.
 *
 * ПЕРЕБОР ОГРАНИЧИВАЕТ САМ ПЛАГИН: после пяти неверных попыток код гаснет, и
 * нужен новый (`allowedAttempts` в `auth/instance.mjs`). Лимитер здесь — как
 * у пароля, по паре адрес+IP, и только против объёма запросов.
 */
const loginCodeVerifyLimiter = authRatePolicy.middleware({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  key: (req) => pairKey("code", req.ip, req.body?.email),
  handler: (_req, res) => res.status(429).json({
    error: true,
    message: "Слишком много попыток. Запросите новый код позже.",
  }),
  failureOnly: true,
});

/**
 * Обмен кода подмены на сеанс. Без авторизации по определению: ссылку
 * открывают в чистом браузере, где сессии ещё нет.
 *
 * Лимитер по IP и жёсткий: код 43 символа из криптостойкого генератора,
 * подобрать его нельзя, но ручка не должна становиться бесплатным способом
 * дёргать базу. Шесть попыток за десять минут — ровно столько живёт сам код.
 */
const impersonationClaimLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: true,
    message: "Слишком много попыток. Попробуйте позже.",
  },
});

router.post(
  "/impersonate/claim",
  impersonationClaimLimiter,
  impersonationController.claim,
);

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

/**
 * Второй шаг входа.
 *
 * ПЕРЕБОР КОДА ОГРАНИЧИВАЕТ НЕ ЭТОТ ЛИМИТЕР, а сам плагин: он считает попытки
 * на КАЖДУЮ проверку отдельно (`2fa-attempts-…` в `authVerifications`, пять
 * попыток) и после пятой требует начать вход заново. Это верная гранулярность
 * — попытка привязана к конкретному входу, а не к адресу.
 *
 * Свой лимитер здесь только против объёма запросов. Ключ — cookie проверки, а
 * не IP: в офисе за одним NAT все сотрудники приходят с одного адреса, и пять
 * чужих опечаток заперли бы вход всей компании на десять минут. IP остаётся
 * запасным ключом для запросов вообще без cookie — таких, которые проверять
 * нечем.
 */
const twoFactorLimiter = authRatePolicy.middleware({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  key: async (req) => challengeKey(req.ip, await getAuth().api.resolveFactorRateIdentity({
    headers: getFromNodeHeaders()(req.headers),
    body: { path: req.body?.backup ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp" },
  })),
  handler: (_req, res) => res.status(429).json({
    error: true,
    message: "Слишком много попыток. Начните вход заново.",
  }),
});

router.post("/login/two-factor", twoFactorLimiter, authController.verifyTwoFactor);

// Вход по коду из письма: запрос кода (гейт и одинаковый ответ на любой адрес
// живут в контроллере) и обмен кода на сеанс.
router.post(
  "/login-code",
  authLimiter,
  loginCodeLimiter,
  authController.requestLoginCode,
);
router.post(
  "/login-code/verify",
  authLimiter,
  loginCodeVerifyLimiter,
  authController.verifyLoginCode,
);
// Новый пароль сотрудника по тому же коду — тот же лимитер: попытки кода
// считаются вместе, где бы его ни вводили.
router.post(
  "/login-code/password",
  authLimiter,
  loginCodeVerifyLimiter,
  authController.resetPasswordByCode,
);

// routes for telegram bot
router.post("/tg/auth", isTelegramBot, authController.authTelegram);

module.exports = router;
