const { body, query } = require("express-validator");

const { CATEGORIES } = require("@/services/notificationCategories");

// Колокольчик: список постранично (курсор — createdAt последней строки) и по
// категориям (фасет панели), «прочитано» по списку, по заявке или всё
// (при фильтре — всё показанного вида); «просмотрено» списком заявок.

exports.list = [
  query("before")
    .optional({ values: "falsy" })
    .isISO8601()
    .withMessage("Некорректный курсор"),
  query("limit")
    .optional({ values: "falsy" })
    .isInt({ min: 1, max: 100 })
    .withMessage("Некорректный размер страницы"),
  // Через запятую: `?category=ticketStateUpdate,respStateUpdate`; неизвестные
  // ключи отбрасывает parseCategories, здесь только форма
  query("category")
    .optional({ values: "falsy" })
    .isString()
    .isLength({ max: 400 })
    .withMessage("Некорректная категория"),
];

exports.read = [
  body("ids").optional().isArray({ max: 200 }).withMessage("Некорректный список"),
  body("ids.*").isMongoId().withMessage("Некорректный идентификатор"),
  body("all").optional().isBoolean().withMessage("Некорректный флаг"),
  body("categories")
    .optional()
    .isArray({ max: CATEGORIES.length })
    .withMessage("Некорректный список категорий"),
  body("categories.*").isIn(CATEGORIES).withMessage("Некорректная категория"),
  body("ticketId")
    .optional({ values: "falsy" })
    .isMongoId()
    .withMessage("Некорректная заявка"),
];

exports.seenMany = [
  body("ids").isArray({ min: 1, max: 500 }).withMessage("Нужен список заявок"),
  body("ids.*").isMongoId().withMessage("Некорректный идентификатор заявки"),
];
