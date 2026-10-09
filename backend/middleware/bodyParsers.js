const express = require("express");

/**
 * Разбор тела запроса — с лимитом по классу маршрута (спека W1, D5).
 *
 * Раньше JSON и формы до 50 МБ принимались на ЛЮБОМ пути, включая ручки без
 * сеанса: тело разбирается до авторизации, и анонимный запрос на вход держал
 * память и процессор под пятьдесят мегабайт. Теперь:
 *   - ручки без сеанса (вход, код из письма, проверка пароля, обмен кода
 *     подмены, согласование по ссылке) — 100 КБ;
 *   - сохранение из редакторов, в чьём JSON едут картинки (заметка базы
 *     знаний, шаблон заявки, регламент: Toast UI вставляет картинку
 *     data:-ссылкой) — 50 МБ, как было;
 *   - всё остальное — 10 МБ. Файлы идут multipart'ом через multer, у него
 *     свои лимиты (middleware/fileUpload.js).
 *
 * ПОРЯДОК ВАЖЕН. body-parser не читает тело второй раз: поток уже вычитан
 * (`isFinished(req)`), и следующий парсер запрос пропускает. Поэтому парсеры
 * конкретных путей стоят ДО общего, и общий их тела не трогает. А всё вместе —
 * ПОСЛЕ better-auth (app.js): тот читает сырое тело сам.
 */

const BODY_LIMITS = Object.freeze({
  anonymous: "100kb",
  editor: "50mb",
  default: "10mb",
});

/**
 * Ручки без сеанса. Это префиксы: `/api/login` накрывает и
 * `/api/login/two-factor` (но не `/api/login-code`), `/api/login-code` —
 * `/verify` и `/password`, `/api/password` — `/check`. Новая ручка без сеанса —
 * в оба списка: сюда и в OPERATOR_GUARD_PATHS (middleware/rejectOperatorKeys.js).
 */
const ANONYMOUS_BODY_PATHS = Object.freeze([
  "/api/login",
  "/api/login-code",
  "/api/password",
  "/api/impersonate/claim",
  "/api/external/approval",
]);

/** Сохранение из редакторов с картинками внутри текста. */
const EDITOR_BODY_PATHS = Object.freeze([
  "/api/knowledge-notes/add",
  "/api/knowledge-notes/update/:id",
  "/api/ticket-templates/add",
  "/api/ticket-templates/update/:id",
  "/api/routine-tasks/add",
  "/api/routine-tasks/update/:id",
]);

const parsers = (limit) => [
  express.json({ limit }),
  express.urlencoded({ extended: true, limit }),
];

/** Вешает парсеры на приложение — в том месте цепочки, где вызван. */
const mountBodyParsers = (app) => {
  app.use(ANONYMOUS_BODY_PATHS, ...parsers(BODY_LIMITS.anonymous));
  app.use(EDITOR_BODY_PATHS, ...parsers(BODY_LIMITS.editor));
  app.use(...parsers(BODY_LIMITS.default));
};

module.exports = {
  ANONYMOUS_BODY_PATHS,
  BODY_LIMITS,
  EDITOR_BODY_PATHS,
  mountBodyParsers,
};
