const { body, param } = require("express-validator");

const mongoose = require("mongoose");

exports.getOne = [param("id").isMongoId().withMessage("Invalid company ID")];

exports.add = [
  body("alias").trim().not().isEmpty().withMessage("Company alias is required"),
  body("fullTitle")
    .trim()
    .not()
    .isEmpty()
    .withMessage("Company full title is required"),
  body("emailDomains")
    .optional()
    .isString()
    .withMessage("Email domains must be an array"),
  body("phones").optional().isString().withMessage("Phone must be a string"),
  body("address").optional().isString().withMessage("Address must be a string"),
  body("linkToMap")
    .optional()
    .isString()
    .withMessage("Link to map must be a string"),
  body("users").optional().isArray().withMessage("Users must be an array"),
  body("users.*")
    .optional()
    .isMongoId()
    .withMessage("User must be a valid MongoDB ID"),
  body("responsibles")
    .optional()
    .isArray()
    .withMessage("Responsibles must be an array"),
  body("responsibles.*")
    .optional()
    .isMongoId()
    .withMessage("Responsible must be a valid MongoDB ID"),
  body("workSchedule")
    .optional()
    .isObject()
    .withMessage("Work schedule must be an object"),
];

exports.update = [
  param("id").isMongoId().withMessage("Invalid company ID"),
  body("alias").trim().not().isEmpty().withMessage("Company alias is required"),
  body("fullTitle")
    .trim()
    .not()
    .isEmpty()
    .withMessage("Company full title is required"),
  body("emailDomains")
    .optional()
    .isString()
    .withMessage("Email domains must be an array"),
  body("phones").optional().isString().withMessage("Phone must be a string"),
  body("address").optional().isString().withMessage("Address must be a string"),
  body("linkToMap")
    .optional()
    .isString()
    .withMessage("Link to map must be a string"),
  body("clientsSideResponsibles")
    .optional()
    .isArray()
    .withMessage("Users must be an array"),
  body("clientsSideResponsibles.*")
    .optional()
    .isMongoId()
    .withMessage("User must be a valid MongoDB ID"),
  body("responsibles")
    .optional()
    .isArray()
    .withMessage("Responsibles must be an array"),
  body("responsibles.*")
    .optional()
    .isMongoId()
    .withMessage("Responsible must be a valid MongoDB ID"),
  body("workSchedule")
    .optional()
    .isObject()
    .withMessage("Work schedule must be an object"),
];

exports.delete = [param("id").isMongoId().withMessage("Invalid company ID")];

exports.addSubdivision = [
  body("name").trim().notEmpty().withMessage("Subdivision name is required"),
  body("address")
    .optional()
    .trim()
    .isString()
    .withMessage("Subdivision address must be string"),
  body("linkToMap")
    .optional()
    .trim()
    .isString()
    .withMessage("Subdivision link to map must be string"),
  body("phone")
    .optional()
    .trim()
    .isString()
    .withMessage("Subdivision phone must be string"),
  body("email")
    .optional()
    .trim()
    .isEmail()
    .withMessage("Subdivision email must be string"),
  body("companyId").isMongoId().withMessage("Invalid company ID"),
  body("parentId").optional().isMongoId().withMessage("Invalid parent ID"),
];

exports.updateSubdivision = [
  body("subdivisionId").isMongoId().withMessage("Invalid subdivision ID"),
  body("name")
    .trim()
    .not()
    .isEmpty()
    .withMessage("Subdivision name is required"),
];

exports.deleteSubdivision = [
  body("subdivisionId").isMongoId().withMessage("Invalid subdivision ID"),
];

exports.updateSubdivisionUsers = [
  body("subdivisionId").isMongoId().withMessage("Invalid subdivision ID"),
  body("users").optional().isArray().withMessage("Users must be an array"),
  body("users.*").isMongoId().withMessage("Invalid user ID in users array"),
  body("manager")
    .optional()
    .custom((value) => {
      return (
        value === null ||
        value === "null" ||
        mongoose.Types.ObjectId.isValid(value)
      );
    })
    .withMessage("Manager must be either null or a valid MongoDB ID"),
];

exports.addServicePlan = [
  body("plan").isMongoId().withMessage("Invalid service plan ID"),
  body("isActiveSince")
    .notEmpty()
    .withMessage("Service plan start date is required"),
  body("customerApprovalRequired")
    .isBoolean()
    .withMessage("Invalid customer approval required value"),
];
exports.deleteServicePlan = [
  body("servicePlanId").isMongoId().withMessage("Invalid service plan ID"),
];
