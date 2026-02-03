const { body } = require("express-validator");

const deviceModelValidation = [
  body("deviceTypeId")
    .notEmpty()
    .withMessage("Device type ID is required")
    .isMongoId()
    .withMessage("Incorrect device type ID"),
  body("vendorId")
    .notEmpty()
    .withMessage("Vendor ID is required")
    .isMongoId()
    .withMessage("Incorrect vendor ID"),
  body("name")
    .isLength({ max: 200 })
    .withMessage("Name must not exceed 200 characters")
    .trim(),
  body("attributes")
    .optional()
    .isArray()
    .withMessage("Attributes must be an array"),
  body("attributes.*.attributeId")
    .optional()
    .isMongoId()
    .withMessage("Incorrect attribute ID"),
  body("attributes.*.value")
    .optional()
    .custom((value) => {
      return true;
    })
    .withMessage("Attribute value is invalid"),
  body("notes")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Notes must not exceed 1000 characters")
    .trim(),
];

module.exports = {
  deviceModelValidation,
};
