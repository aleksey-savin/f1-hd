const { body } = require("express-validator");

// Суммы в теле не принимаются нигде: их считает services/servicePlanBilling
// по составу работ. Клиент задаёт только СОСТАВ и решение.

exports.create = [
  body("companyId")
    .notEmpty()
    .withMessage("Не указана компания")
    .isMongoId()
    .withMessage("Некорректный идентификатор компании"),
  body("servicePlanId")
    .notEmpty()
    .withMessage("Не указана услуга")
    .isMongoId()
    .withMessage("Некорректный идентификатор услуги"),
  body("workIds")
    .isArray({ min: 1 })
    .withMessage("В отчёт не попало ни одной работы"),
  body("workIds.*").isMongoId().withMessage("Некорректный идентификатор работы"),
];

exports.resubmit = [
  body("workIds").optional().isArray(),
  body("workIds.*").optional().isMongoId(),
];

exports.decision = [
  body("approve").isBoolean().withMessage("Не указано решение"),
  body("subdivisionId")
    .optional({ nullable: true })
    .isMongoId()
    .withMessage("Некорректный идентификатор подразделения"),
  // Причина обязательна при отказе — её проверяет контроллер, здесь только
  // ограничение длины: она уходит исполнителю уведомлением
  body("comment").optional({ nullable: true }).isString().isLength({ max: 500 }),
];

exports.invoice = [
  body("number").trim().notEmpty().withMessage("Укажите номер счёта"),
  body("date").notEmpty().withMessage("Укажите дату счёта").isISO8601(),
];

exports.payment = [
  body("paidAt").notEmpty().withMessage("Укажите дату оплаты").isISO8601(),
];
