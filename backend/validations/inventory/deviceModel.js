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
  body("notes")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Notes must not exceed 1000 characters")
    .trim(),
];

module.exports = {
  deviceModelValidation,
};
