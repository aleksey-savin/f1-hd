const { body, query } = require("express-validator");

// Колокольчик: список постранично (курсор — createdAt последней строки),
// «прочитано» по списку, по заявке или всё; «просмотрено» списком заявок.

exports.list = [
  query("before")
    .optional({ values: "falsy" })
    .isISO8601()
    .withMessage("Некорректный курсор"),
  query("limit")
    .optional({ values: "falsy" })
    .isInt({ min: 1, max: 100 })
    .withMessage("Некорректный размер страницы"),
];

exports.read = [
  body("ids").optional().isArray({ max: 200 }).withMessage("Некорректный список"),
  body("ids.*").isMongoId().withMessage("Некорректный идентификатор"),
  body("all").optional().isBoolean().withMessage("Некорректный флаг"),
  body("ticketId")
    .optional({ values: "falsy" })
    .isMongoId()
    .withMessage("Некорректная заявка"),
];

exports.seenMany = [
  body("ids").isArray({ min: 1, max: 500 }).withMessage("Нужен список заявок"),
  body("ids.*").isMongoId().withMessage("Некорректный идентификатор заявки"),
];
