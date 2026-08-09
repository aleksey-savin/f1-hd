const express = require("express");
const rateLimit = require("express-rate-limit");

const meController = require("@/controllers/me");
const requireAuth = require("@/middleware/requireAuth");

const router = express.Router();

// Живая подсказка дёргается по ходу набора, поэтому счётчик свой и щедрый.
// Он тут не от подбора (проверяется пароль, который человек печатает у себя),
// а от того, чтобы дребезг на клиенте не превратился в поток запросов наружу.
//
// Без сеанса лимит втрое строже: страницу нового пароля открывают по ссылке из
// письма, и там за раз придумывают один пароль, а не перебирают.
const passwordCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => (req.auth ? 60 : 20),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ ok: true, checked: false, throttled: true }),
});

// Профиль, эффективные права, рубильники модулей и настройки — одним запросом.
router.get("/me", requireAuth, meController.getMe);

// Выход гасит серверный сеанс. Требует авторизации намеренно: выход без сеанса
// — не ошибка, но и не операция.
router.post("/logout", requireAuth, meController.logout);

/**
 * Свои сеансы. Всем, включая клиентов: «где я залогинен» — вопрос про свою
 * учётную запись, а не про портал, и ответ на него не зависит от роли.
 */
router.get("/me/sessions", requireAuth, meController.sessions);
router.delete("/me/sessions/:id", requireAuth, meController.revokeSession);
router.post(
  "/me/sessions/revoke-others",
  requireAuth,
  meController.revokeOtherSessions,
);

// Живая проверка пароля для формы: длина плюс списки утечек.
//
// БЕЗ requireAuth намеренно. Пароль задают и без сеанса — на странице по
// ссылке из письма, и именно там подсказка нужнее всего: рядом нет
// администратора, который объяснит, почему `01012000` не подходит. Секрета
// ручка не выдаёт: наружу уходит пять символов SHA1 (k-анонимность), а в
// ответе — то же самое, что человек и так получит на отправке формы.
router.post("/password/check", passwordCheckLimiter, meController.checkPassword);

module.exports = router;
