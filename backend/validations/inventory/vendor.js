const { body } = require("express-validator");

const vendorValidation = [
  body("name")
    .notEmpty()
    .withMessage("Название вендора обязательно")
    .isLength({ min: 2, max: 100 })
    .withMessage("Название должно содержать от 2 до 100 символов")
    .trim(),
  body("description")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Описание не должно превышать 500 символов")
    .trim(),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("Поле isActive должно быть булевым значением"),
];

module.exports = {
  vendorValidation,
};
