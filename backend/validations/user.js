const { body, param } = require("express-validator");
const User = require("../models/user");

exports.getOne = [param("id").isMongoId().withMessage("Invalid user ID")];

exports.add = [
  body("email")
    .isEmail()
    .withMessage("Please enter a valid email.")
    .custom(async (value) => {
      const user = await User.findOne({ email: value });
      if (user) {
        return Promise.reject("Email address already exists");
      }
    })
    .normalizeEmail(),
  body("password")
    .trim()
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
  body("firstName")
    .trim()
    .not()
    .isEmpty()
    .withMessage("First name is required"),
  body("lastName").trim().not().isEmpty().withMessage("Last name is required"),
  body("role").trim().not().isEmpty().withMessage("Role is required"),
  body("isActive").isBoolean().withMessage("isActive must be a boolean"),
];

exports.update = [
  param("id").isMongoId().withMessage("Invalid user ID"),
  body("email")
    .optional()
    .isEmail()
    .withMessage("Please enter a valid email.")
    .custom(async (value, { req }) => {
      const user = await User.findOne({ email: value });
      if (user && user._id.toString() !== req.params.id) {
        return Promise.reject("Email address already exists");
      }
    })
    .normalizeEmail(),
  body("firstName")
    .optional()
    .trim()
    .not()
    .isEmpty()
    .withMessage("First name cannot be empty if provided"),
  body("lastName")
    .optional()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Last name cannot be empty if provided"),
  body("role")
    .optional()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Role cannot be empty if provided"),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean"),
];

exports.updateMyAccount = [
  body("firstName")
    .optional()
    .trim()
    .not()
    .isEmpty()
    .withMessage("First name cannot be empty if provided"),
  body("lastName")
    .optional()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Last name cannot be empty if provided"),
  body("phone").optional().trim(),
  body("darkMode")
    .optional()
    .isBoolean()
    .withMessage("darkMode must be a boolean"),
];

exports.delete = [param("id").isMongoId().withMessage("Invalid user ID")];

exports.changePassword = [
  param("id").isMongoId().withMessage("Invalid user ID"),
  body("password")
    .trim()
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
];
