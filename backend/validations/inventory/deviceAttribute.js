const { body } = require("express-validator");

const deviceAttributeValidation = [
  body("name").notEmpty().withMessage("Name is required"),
  body("label").optional().isString().withMessage("Label must be a string"),
  body("description")
    .optional()
    .isString()
    .withMessage("Description must be a string"),
  body("dataType")
    .notEmpty()
    .withMessage("Data type is required")
    .isIn(["string", "number", "boolean", "date", "array", "object"])
    .withMessage("Invalid data type"),
  body("unit").isString().withMessage("Unit must be a string"),
  body("isActive").isBoolean().withMessage("Active status must be a boolean"),
  body("displayOrder").isInt().withMessage("Display order must be an integer"),
];

module.exports = { deviceAttributeValidation };
