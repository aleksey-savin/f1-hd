const { body, param } = require("express-validator");

exports.getOne = [
  param("id").isMongoId().withMessage("Invalid service plan ID"),
];

exports.add = [
  body("title").trim().notEmpty().withMessage("Title is required"),
  body("type")
    .isIn(["hourPackage", "fixedPrice", "hourly"])
    .withMessage("Invalid service plan type"),
  body("companyWorkSchedule")
    .optional()
    .isBoolean()
    .withMessage("companyWorkSchedule must be boolean"),
  body("tariffingPeriod")
    .isNumeric()
    .withMessage("Tariffing period must be numeric")
    .custom((value) => value >= 1)
    .withMessage("Tariffing period must be at least 1 minute"),
  body("hourPackages")
    .if(body("type").equals("hourPackage"))
    .isArray({ min: 1 })
    .withMessage("Hour packages are required for hourPackage type"),
  body("hourPackages.*.hours")
    .if(body("type").equals("hourPackage"))
    .isNumeric()
    .withMessage("Hours must be numeric")
    .custom((value) => value >= 0)
    .withMessage("Hours must be non-negative"),
  body("hourPackages.*.pricePerHour")
    .if(body("type").equals("hourPackage"))
    .isNumeric()
    .withMessage("Price per hour must be numeric")
    .custom((value) => value >= 0)
    .withMessage("Price per hour must be non-negative"),
  body("fixedPrice")
    .if(body("type").equals("fixedPrice"))
    .isNumeric()
    .withMessage("Fixed price must be numeric")
    .custom((value) => value >= 0)
    .withMessage("Fixed price must be non-negative"),
  body("pricePerHour")
    .if(body("type").equals("hourly"))
    .isNumeric()
    .withMessage("Price per hour must be numeric")
    .custom((value) => value >= 0)
    .withMessage("Price per hour must be non-negative"),
  body("pricePerHourNonWorking")
    .optional()
    .isNumeric()
    .withMessage("Price per hour for non-working hours must be numeric")
    .custom((value) => value >= 0)
    .withMessage("Price per hour for non-working hours must be non-negative"),
];

exports.update = [
  param("id").isMongoId().withMessage("Invalid service plan ID"),
  body("title")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Title cannot be empty if provided"),
  body("type")
    .optional()
    .isIn(["hourPackage", "fixedPrice", "hourly"])
    .withMessage("Invalid service plan type"),
  body("companyWorkSchedule")
    .optional()
    .isBoolean()
    .withMessage("companyWorkSchedule must be boolean"),
];

exports.delete = [
  param("id").isMongoId().withMessage("Invalid service plan ID"),
];
