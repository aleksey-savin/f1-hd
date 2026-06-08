const { body } = require("express-validator");

const supplierValidation = [
  body("name")
    .notEmpty()
    .withMessage("Название поставщика обязательно")
    .isLength({ min: 2, max: 100 })
    .withMessage("Название должно содержать от 2 до 100 символов")
    .trim(),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("Поле isActive должно быть булевым значением"),
];

module.exports = {
  supplierValidation,
};
