const { body } = require("express-validator");

const deviceTypeValidation = [
  body("name")
    .notEmpty()
    .withMessage("Название типа устройства обязательно")
    .isLength({ min: 2, max: 100 })
    .withMessage("Название должно содержать от 2 до 100 символов")
    .trim(),
  body("attachableToTypeIds")
    .optional()
    .isArray()
    .withMessage("Поле attachableToTypeIds должно быть массивом"),
  body("isActive")
    .isBoolean()
    .withMessage("Поле isActive должно быть булевым значением"),
  body("isComponent")
    .isBoolean()
    .withMessage("Поле isComponent должно быть булевым значением"),
  body("isConsumable")
    .isBoolean()
    .withMessage("Поле isConsumable должно быть булевым значением"),
];

module.exports = {
  deviceTypeValidation,
};
