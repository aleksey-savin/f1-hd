const Router = require("express");
const router = new Router();
const notificationController = require("@/controllers/notification");
const isAuth = require("@/middleware/isAuth");
const notificationValidation = require("@/validations/notification");
const { runValidation } = require("@/middleware/runValidation");

// Колокольчик: личный список, счётчик и «прочитано». Права словаря не нужны —
// каждый читает и правит только своё (контроллер отсекает по req.auth.userId).
// «Просмотрено» по заявкам — в routes/internal/ticket.js, за проверкой доступа.
router.get(
  "/notifications",
  isAuth,
  notificationValidation.list,
  runValidation,
  notificationController.list,
);
router.get("/notifications/summary", isAuth, notificationController.summary);
router.post(
  "/notifications/read",
  isAuth,
  notificationValidation.read,
  runValidation,
  notificationController.read,
);

module.exports = router;
