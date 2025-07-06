const { body } = require("express-validator");

exports.update = [
  body("timezone").isString().isLength({ min: 1, max: 50 }),
  body("htmlDesc").isBoolean(),
  body("useEmail").isBoolean(),
  body("emailAddress").isEmail(),
  body("imapServer").isString().isLength({ min: 1, max: 100 }),
  body("defaultApplicant").isObject(),
  body("defaultCompany").isObject(),
  body("identifyCompany").isBoolean(),
  body("identifyApplicant").isBoolean(),
  body("checkPhoneNumber").isBoolean(),
  body("deadline").isNumeric(),
  body("notify").isObject(),
  body("contacts").isObject(),
  body("getScreen").isObject(),
  body("modules").isObject(),
];
