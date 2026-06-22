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
  body("attributes")
    .optional()
    .isArray()
    .withMessage("Поле attributes должно быть массивом"),
  body("attributes.*.attributeId")
    .optional()
    .isMongoId()
    .withMessage("attributeId должен быть валидным MongoDB ID"),
  body("attributes.*.required")
    .optional()
    .isBoolean()
    .withMessage("Поле required должно быть булевым значением"),
  body("attributes.*.extendable")
    .optional()
    .isBoolean()
    .withMessage("Поле extendable должно быть булевым значением"),
  body("isActive")
    .isBoolean()
    .withMessage("Поле isActive должно быть булевым значением"),
  body("isComponent")
    .isBoolean()
    .withMessage("Поле isComponent должно быть булевым значением"),
  body("isConsumable")
    .isBoolean()
    .withMessage("Поле isConsumable должно быть булевым значением"),
  body("inventoryPrefix")
    .optional({ checkFalsy: true })
    .isLength({ max: 12 })
    .withMessage("Префикс не должен превышать 12 символов")
    .trim(),
];

module.exports = {
  deviceTypeValidation,
};
