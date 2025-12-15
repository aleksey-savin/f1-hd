const express = require("express");
const rateLimit = require("express-rate-limit");
const { formatInTimeZone } = require("date-fns-tz");

const authController = require("@/controllers/auth");
const isTelegramBot = require("@/middleware/isTelegramBot");
const logger = require("@/utils/logger");

const { runValidation } = require("@/middleware/runValidation");
const authValidation = require("@/validations/auth");

const Preferences = require("@/models/preferences");

const router = express.Router();

async function formatResetTime(resetTimeMs) {
  // Try to get timezone from preferences or default to Moscow time
  let timezone = "Europe/Moscow"; // Default timezone
  let mskOffset = 0; // Default offset from Moscow

  try {
    const preferences = await Preferences.findOne({});
    if (preferences?.timezone) {
      timezone = preferences.timezone;

      // Predefined offsets for common Russian timezones from Moscow
      const timezoneOffsets = {
        "Europe/Kaliningrad": -1,
        "Europe/Moscow": 0,
        "Europe/Samara": 1,
        "Asia/Yekaterinburg": 2,
        "Asia/Omsk": 3,
        "Asia/Krasnoyarsk": 4,
        "Asia/Irkutsk": 5,
        "Asia/Yakutsk": 6,
        "Asia/Vladivostok": 7,
        "Asia/Magadan": 8,
        "Asia/Kamchatka": 9,
      };

      // Use predefined offset if available, otherwise calculate it
      if (Object.hasOwn(timezoneOffsets, timezone)) {
        mskOffset = timezoneOffsets[timezone];
      } else {
        // Fallback to calculation if timezone is not in our predefined list
        const date = new Date();

        // Get current time in milliseconds in both timezones
        const mskTime = new Date(
          date.toLocaleString("en-US", { timeZone: "Europe/Moscow" }),
        ).getTime();
        const tzTime = new Date(
          date.toLocaleString("en-US", { timeZone: timezone }),
        ).getTime();

        // Calculate difference in hours
        mskOffset = Math.round((tzTime - mskTime) / (1000 * 60 * 60));
      }
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

router.post(
  "/signup",
  authLimiter,
  authValidation.signup,
  runValidation,
  authController.signup,
);

router.post(
  "/first-launch",
  authValidation.firstLaunch,
  runValidation,
  authController.firstLaunch,
);

router.post(
  "/login",
  authLimiter,
  loginLimiter,
  authValidation.login,
  runValidation,
  authController.login,
);
router.put(
  "/forgot-password",
  authLimiter,
  authValidation.forgotPassword,
  runValidation,
  authController.forgotPassword,
);
router.post(
  "/reset-password",
  authLimiter,
  authValidation.resetPassword,
  runValidation,
  authController.resetPassword,
);
router.get(
  "/validate-reset-token/:token",
  authValidation.validateResetToken,
  runValidation,
  authController.validateResetToken,
);

// routes for telegram bot
router.post("/tg/auth", isTelegramBot, authController.authTelegram);

module.exports = router;
