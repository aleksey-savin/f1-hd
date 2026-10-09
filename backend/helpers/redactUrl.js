/**
 * Адрес запроса для журнала: без строки запроса и без токена в пути.
 *
 * В query бывает что угодно, включая токены входа
 * (`/api/auth/magic-link/verify?token=…`), а в пути
 * `/api/external/approval/:token` сам токен и есть авторизация: ссылка из
 * письма открывает отчёт без входа. Журнал читают те, кому эти ссылки не
 * адресованы.
 *
 * Регистр не различается: Express ищет маршрут без его учёта, и
 * `/api/EXTERNAL/approval/<токен>` доходит до того же обработчика.
 */
const APPROVAL_TOKEN = /(\/external\/approval\/)[^/]+/i;

/**
 * @param {string} [url] `req.originalUrl`
 * @returns {string|undefined} путь без query, токен согласования — `***`
 */
const redactUrl = (url) => {
  if (typeof url !== "string") return url;
  const queryAt = url.indexOf("?");
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  return path.replace(APPROVAL_TOKEN, "$1***");
};

module.exports = { redactUrl };
