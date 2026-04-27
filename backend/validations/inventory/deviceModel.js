const { body } = require("express-validator");

const deviceModelValidation = [
  body("deviceTypeId")
    .optional()
    .isMongoId()
    .withMessage("Device type ID must be a valid MongoDB ID"),
  body("vendorId")
    .optional()
    .isMongoId()
    .withMessage("Vendor ID must be a valid MongoDB ID"),
  body("name")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Name must not exceed 200 characters")
    .trim(),
  body("configurationIds")
    .optional()
    .isArray()
    .withMessage("Configuration IDs must be an array"),
  body("configurationIds.*")
    .optional()
    .isMongoId()
    .withMessage("Configuration ID must be a valid MongoDB ID"),
  body("compatibleWithModelIds")
    .optional()
    .isArray()
    .withMessage("Compatible model IDs must be an array"),
  body("compatibleWithModelIds.*")
    .optional()
    .isMongoId()
    .withMessage("Compatible model ID must be a valid MongoDB ID"),
  body("notes")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Notes must not exceed 1000 characters")
    .trim(),
];

module.exports = {
  deviceModelValidation,
};
