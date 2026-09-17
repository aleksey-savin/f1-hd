const { hashApiKey, isMcpKeyFormat } = require("../utils/apiKeyGenerator");

/**
 * Ключ ИИ-агента к MCP (routes/mcp.js): `Authorization: Bearer hd_mcp_…`.
 *
 * СРАВНИВАЕТСЯ ОТПЕЧАТОК: в базе лежит sha256, само значение показывается
 * администратору один раз при выдаче (controllers/mcpKey.js). Только заголовок:
 * строка запроса оседает в access.log nginx и в наших логах.
 *
 * Отказ отвечается здесь же, а не через `next(AppError)`: общий обработчик
 * после ответа зовёт `next(error)`, и finalhandler рвёт соединение — клиенту
 * MCP нужен нормальный 401 с вызовом `WWW-Authenticate`. Ошибка базы, наоборот,
 * уходит в общий обработчик: это не «ключ плохой», и отвечать 401 на неё нельзя.
 *
 * `req.auth` не трогаем: это личность сотрудника из сеанса, у агента её нет.
 * Кто пришёл — в `req.mcpKey` (id и название, без значения).
 *
 * Зависимости приходят аргументами: сборка с моделью и логгером — в
 * routes/mcp.js, тест — на заглушках без базы и без файловых логов.
 */

/**
 * Отметка «когда работал» пишется не чаще раза в час — как у ключей компаний
 * (middleware/isAuthApiKey.js): точности до часа хватает, чтобы отличить живой
 * ключ от забытого, а агент ходит на каждом вопросе.
 */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

const BEARER = /^Bearer\s+(\S+)$/i;

const createRequireMcpKey = ({
  findKeyByHash,
  touchKey,
  log,
  now = Date.now,
}) => {
  const deny = (req, res, reason) => {
    log("warn", "MCP: ключ доступа не принят", {
      reason,
      endpoint: req.originalUrl,
      ip: req.ip,
    });
    res.set("WWW-Authenticate", 'Bearer realm="hd-mcp"');
    return res.status(401).json({
      error: true,
      status: 401,
      message: "Недействительный ключ доступа",
    });
  };

  return async (req, res, next) => {
    try {
      const token = BEARER.exec(req.get("Authorization") || "")?.[1];
      if (!token) return deny(req, res, "missing");
      // Формат проверяется до базы: мусор и ключи компаний не стоят запроса.
      if (!isMcpKeyFormat(token)) return deny(req, res, "malformed");

      const key = await findKeyByHash(hashApiKey(token));
      if (!key) return deny(req, res, "unknown");

      const lastUsed = key.lastUsedAt ? new Date(key.lastUsedAt).getTime() : 0;
      if (now() - lastUsed >= TOUCH_EVERY_MS) {
        // Отметка не должна ломать запрос: агент пришёл за ответом.
        Promise.resolve()
          .then(() => touchKey(key._id))
          .catch(() => {});
      }

      req.mcpKey = { _id: key._id, name: key.name };
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = { createRequireMcpKey };
