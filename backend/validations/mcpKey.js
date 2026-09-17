const { body } = require("express-validator");

// Ключи ИИ-агентов к базе знаний (Настройки, routes/internal/preferences.js).
// Название обрезается здесь: контроллер ищет дубликат уже по обрезанному.

exports.create = [
  body("name")
    .isString()
    .withMessage("Укажите название ключа")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Укажите название ключа")
    .bail()
    .isLength({ max: 100 })
    .withMessage("Название ключа — не длиннее 100 знаков"),
];

exports.remove = [
  body("_id").isMongoId().withMessage("Некорректный идентификатор ключа"),
];
