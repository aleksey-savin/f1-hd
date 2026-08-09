const crypto = require("crypto");

const { AppError } = require("./errorHandling");
const logger = require("../utils/logger");

/**
 * Общий секрет между бэкендом и telegram-bot. Заголовок, и только заголовок:
 * строка запроса целиком попадает в `access.log` nginx (`$request` в
 * `log_format main`) и в наши winston-логи, то есть при передаче через query
 * токен оседал в двух журналах на каждом вызове.
 *
 * Переходная поддержка `?api_token=` СНЯТА: бот шлёт заголовок всеми четырьмя
 * вызовами (`telegram-bot/middleware/tgBotApi.js:99,117,136,577`), а пока
 * запасная дорога открыта, любой токен, утёкший в старый `access.log`,
 * остаётся рабочим ключом.
 */
const HEADER = "x-tg-token";

// Сравнение постоянного времени. Длины сначала сверяем отдельно:
// timingSafeEqual бросает на буферах разной длины.
const tokensMatch = (expected, received) => {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = (req, res, next) => {
  const contextLogger = logger.addNoAuthContext(req);
  const expected = process.env.TG_API_TOKEN;
  const received = req.get(HEADER);

  // Раньше здесь было `process.env.TG_API_TOKEN === apiToken`: при незаданной
  // переменной запрос без токена давал `undefined === undefined`, то есть
  // проходил. Пустой секрет — это отказ, а не разрешение.
  if (!expected) {
    contextLogger.log("error", "TG_API_TOKEN не задан — доступ бота закрыт");
    return next(new AppError("Некорректный токен", 401));
  }

  if (!received || !tokensMatch(expected, received)) {
    contextLogger.log("error", "Некорректный токен");
    return next(new AppError("Некорректный токен", 401));
  }

  next();
};
