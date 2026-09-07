const { body } = require("express-validator");

const deviceAttributeValidation = [
  body("code")
    .notEmpty()
    .withMessage("Code is required")
    .isString()
    .withMessage("Code must be a string")
    .trim()
    .toLowerCase(),
  body("name")
    .notEmpty()
    .withMessage("Name is required")
    .isString()
    .withMessage("Name must be a string")
    .trim(),
  body("valueType")
    .notEmpty()
    .withMessage("Value type is required")
    .isIn(["string", "number", "boolean", "select", "multiselect", "text"])
    .withMessage("Invalid value type"),
  body("unit")
    .optional()
    .isString()
    .withMessage("Unit must be a string")
    .trim(),
  body("options").optional().isArray().withMessage("Options must be an array"),
  body("options.*.value")
    .optional()
    .isString()
    .withMessage("Option value must be a string"),
  body("options.*.label")
    .optional()
    .isString()
    .withMessage("Option label must be a string"),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("Active status must be a boolean"),
];

// Привязка атрибута к типам сразу набором (PUT /:id/device-types): пустой
// массив — законный ввод, он отвязывает атрибут ото всех типов.
const deviceAttributeTypesValidation = [
  body("deviceTypeIds")
    .isArray()
    .withMessage("Device type ids must be an array"),
  body("deviceTypeIds.*")
    .isMongoId()
    .withMessage("Invalid device type id"),
];

module.exports = { deviceAttributeValidation, deviceAttributeTypesValidation };
