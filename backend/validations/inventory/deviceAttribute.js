const { body } = require("express-validator");

const deviceAttributeValidation = [
  // Код необязателен: форма его не спрашивает, при создании он выводится из
  // наименования (services/attributeCode), при правке остаётся прежним.
  body("code")
    .optional({ values: "falsy" })
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
    .isIn(["string", "number", "boolean", "select", "multiselect", "text", "date"])
    .withMessage("Invalid value type"),
  body("scope")
    .optional()
    .isIn(["model", "device"])
    .withMessage("Уровень атрибута — model или device"),
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
