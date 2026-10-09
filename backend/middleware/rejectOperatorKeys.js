/**
 * Ключи-операторы Mongo в теле запроса — сразу 400 (спека W1, §4).
 *
 * `{"email": {"$ne": null}}` вместо адреса превращает поиск «пользователь с
 * этим адресом» в «любой пользователь»; ключ с точкой (`"company._id"`) —
 * тот же приём через путь к вложенному полю. Легальному телу ни то ни другое
 * не нужно: имена полей у нас без `$` и без точек. Значения не проверяются —
 * пароль `$ecret` и адрес `a.b@c.d` проходят.
 *
 * Где стоит — OPERATOR_GUARD_PATHS (app.js, после разбора тела): внешний API
 * и ручки без сеанса, где тело пишет кто угодно. Глобально — в W5, после
 * ревизии остальных маршрутов. Multipart разбирает multer уже в маршруте, туда
 * этот слой не достаёт: значения, по которым ищутся люди и категория (userId,
 * userEmail, categoryId), внешняя заявка приводит к строкам сама
 * (services/externalApi); остальные поля уходят в документ как есть
 * (customFields[].value — Mixed), в условия поиска по базе они не попадают.
 *
 * Отказ отвечается здесь же, формой общего обработчика, а не через
 * `next(AppError)`: тот после ответа зовёт `next(error)`, и finalhandler рвёт
 * соединение (см. middleware/requireMcpKey.js).
 *
 * Обход — стеком, не рекурсией: вложенность тела ограничена только размером,
 * и рекурсия по ста килобайтам скобок упёрлась бы в стек.
 */

/**
 * Внешний API и ручки без сеанса. Новая ручка без сеанса — в оба списка: сюда
 * и в ANONYMOUS_BODY_PATHS (middleware/bodyParsers.js).
 */
const OPERATOR_GUARD_PATHS = Object.freeze([
  "/api/external",
  "/api/login",
  "/api/login-code",
  "/api/password",
  "/api/impersonate/claim",
]);

const isOperatorKey = (key) => key.startsWith("$") || key.includes(".");

/** Ключ-оператор на любой глубине или null; из нескольких — любой. */
const findOperatorKey = (body) => {
  const stack = [body];
  while (stack.length) {
    const value = stack.pop();
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    for (const key of Object.keys(value)) {
      if (isOperatorKey(key)) return key;
      stack.push(value[key]);
    }
  }
  return null;
};

const rejectOperatorKeys = (req, res, next) => {
  const key = findOperatorKey(req.body);
  if (key === null) return next();
  return res.status(400).json({
    error: true,
    status: 400,
    code: "ERR_400",
    message: `Недопустимое имя поля «${key.slice(0, 64)}»: ключи с «$» и «.» не принимаются`,
  });
};

module.exports = { OPERATOR_GUARD_PATHS, findOperatorKey, rejectOperatorKeys };
