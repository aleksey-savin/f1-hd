const Router = require("express");
const router = new Router();

const { body } = require("express-validator");

const {
  getByToken,
  decideByToken,
} = require("@/controllers/external/approval");
const { runValidation } = require("@/middleware/runValidation");

/**
 * Согласование отчёта по ссылке из письма.
 *
 * Без isAuth и без API-ключа: авторизацией служит сам токен в адресе — он
 * персональный, одноразовый и живёт ограниченное время
 * (`accessTokens[]` в models/finances/servicePlanReport).
 * Наружу отдаётся ровно один отчёт, принимается ровно одно решение по нему.
 */

router.get("/approval/:token", getByToken);

router.post(
  "/approval/:token/decision",
  body("approve").isBoolean().withMessage("Не указано решение"),
  body("comment").optional({ nullable: true }).isString().isLength({ max: 500 }),
  runValidation,
  decideByToken,
);

module.exports = router;
