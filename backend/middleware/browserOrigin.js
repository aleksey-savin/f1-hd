const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Для этих служебных пространств нужны собственные credentials; если роутер
// передаст запрос дальше, browser cookie всё равно будет удалена.
const ISOLATED_SERVICE_PATH = /^\/api\/(?:bot|gateway|mcp)(?:\/|$)/i;
// Другие служебные ручки используют роутеры вместе с браузерными маршрутами:
// нельзя исключать целые пространства имён. В частности, внешнее согласование —
// браузерный сценарий, а устаревший /tg/tickets/add закомментирован, не исключён.
const SERVICE_ROUTES = new Set([
  'POST /api/wazzup/webhook',
  "POST /api/external/log/user-activity",
  "POST /api/external/ticket/create",
  "POST /api/tg/auth",
  "POST /api/tg/set-work-status",
  "GET /api/tg/tickets/all-opened",
  "HEAD /api/tg/tickets/all-opened",
]);

const urlOrigin = (value, originOnly = false) => {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value) || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    // Origin не содержит путь (включая завершающий слеш), query или fragment.
    if (originOnly && !/^https?:\/\/[^/?#]+$/i.test(value)) return null;
    return url.origin;
  } catch {
    return null;
  }
};

const browserOrigin = ({ publicUrl, allowedOrigins = [] } = {}) => {
  const origins = new Set([
    urlOrigin(publicUrl),
    ...allowedOrigins.map((value) => urlOrigin(value, true)),
  ].filter(Boolean));

  return (req, res, next) => {
    const path = req.originalUrl.split("?")[0];
    const servicePath = path.replace(/\/$/, "").toLowerCase();
    if (ISOLATED_SERVICE_PATH.test(path) || SERVICE_ROUTES.has(`${req.method} ${servicePath}`)) {
      // В служебных запросах нет браузерной личности, включая старые маршруты,
      // проходящие через attachSession. Сохраняем все выделенные заголовки учётных данных.
      delete req.headers.cookie;
      return next();
    }
    if (SAFE_METHODS.has(req.method)) return next();

    // Явный Origin имеет приоритет: недопустимое, null или чужое значение
    // нельзя оправдать Referer, Fetch Metadata или заголовком служебного запроса.
    const origin = req.headers.origin === undefined
      ? urlOrigin(req.headers.referer)
      : urlOrigin(req.headers.origin, true);
    if (origin && origins.has(origin)) return next();
    return res.status(403).json({
      error: true,
      status: 403,
      code: "ERR_403",
      message: "Недостаточно прав",
    });
  };
};
module.exports = { browserOrigin };
