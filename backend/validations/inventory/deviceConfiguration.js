const { body } = require("express-validator");

const deviceConfigurationValidation = [
  body("deviceModelId")
    .notEmpty()
    .withMessage("Device model ID is required")
    .isMongoId()
    .withMessage("Device model ID must be a valid MongoDB ID"),
  body("values")
    .optional()
    .isArray()
    .withMessage("Values must be an array"),
  body("values.*.attributeId")
    .optional()
    .isMongoId()
    .withMessage("Attribute ID must be a valid MongoDB ID"),
  body("values.*.value")
    .optional()
    .isString()
    .withMessage("Attribute value must be a string")
    .trim(),
];

module.exports = {
  deviceConfigurationValidation,
};
