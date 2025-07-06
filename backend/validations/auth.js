const { body, param } = require("express-validator");
const User = require("../models/user");

exports.signup = [
  body("email")
    .isEmail()
    .withMessage("Please enter a valid email.")
    .custom(async (value) => {
      const user = await User.findOne({ email: value });
      if (user) {
        return Promise.reject("Email address already exists");
      }
    }),
  body("password")
    .trim()
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
  body("firstName").trim().notEmpty().withMessage("First name is required"),
  body("lastName").trim().notEmpty().withMessage("Last name is required"),
];

exports.firstLaunch = [
  body("userEmail")
    .isEmail()
    .withMessage("Please enter a valid email.")
    .normalizeEmail(),
  body("userPassword")
    .trim()
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
  body("userFirstName").trim().notEmpty().withMessage("First name is required"),
  body("userLastName").trim().notEmpty().withMessage("Last name is required"),
];

exports.login = [
  body("email").isEmail().withMessage("Please enter a valid email."),
  body("password").trim().notEmpty().withMessage("Password is required"),
];

exports.forgotPassword = [
  body("email")
    .isEmail()
    .withMessage("Please enter a valid email.")
    .normalizeEmail(),
];

exports.resetPassword = [
  body("token").trim().notEmpty().withMessage("Token is required"),
  body("password")
    .trim()
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
];

exports.validateResetToken = [
  param("token").trim().notEmpty().withMessage("Token is required"),
];
