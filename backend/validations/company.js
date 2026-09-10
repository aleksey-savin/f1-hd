const { isPartialWeekSchedule } = require("./workSchedule");

const { body, param } = require("express-validator");

const mongoose = require("mongoose");

const { isValidTimezone } = require("../services/clientTimezone");

// Часовой пояс клиента: пустая строка/null = «наследовать» (компания → зона
// организации). Проверяем существование зоны — битое значение позже роняло бы
// форматирование дат.
const optionalTimezone = (field) =>
  body(field)
    .optional({ nullable: true })
    .custom((value) => value === "" || isValidTimezone(value))
    .withMessage(`${field} must be a valid IANA time zone`);

// Телефоны: tw-форма шлёт массив строк, легаси-форма — одну строку; контроллер
// принимает оба (controllers/company.js). express-validator 7 элементы массива
// сам не проверяет (isString() на массиве — отказ), поэтому проверяем сами.
const isPhoneList = (value) =>
  typeof value === "string" ||
  (Array.isArray(value) && value.every((phone) => typeof phone === "string"));

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
  body("phones")
    .optional()
    .custom(isPhoneList)
    .withMessage("Phones must be a string or an array of strings"),
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
    .custom(isPartialWeekSchedule)
    .withMessage("Work schedule must be an object"),
  optionalTimezone("timezone"),
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
  body("phones")
    .optional()
    .custom(isPhoneList)
    .withMessage("Phones must be a string or an array of strings"),
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
    .custom(isPartialWeekSchedule)
    .withMessage("Work schedule must be an object"),
  optionalTimezone("timezone"),
];

exports.delete = [param("id").isMongoId().withMessage("Invalid company ID")];

exports.toggleActive = [
  param("id").isMongoId().withMessage("Invalid company ID"),
];

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
  optionalTimezone("timezone"),
];

exports.updateSubdivision = [
  body("subdivisionId").isMongoId().withMessage("Invalid subdivision ID"),
  body("name")
    .trim()
    .not()
    .isEmpty()
    .withMessage("Subdivision name is required"),
  optionalTimezone("timezone"),
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
  body("subdivisionApprovalRequired")
    .optional()
    .isBoolean()
    .withMessage("Invalid subdivision approval value"),
  // Пустая строка — «не назначен»: форма шлёт её, когда согласование выключено
  body("approverId")
    .optional({ values: "falsy" })
    .isMongoId()
    .withMessage("Некорректный идентификатор согласующего"),
];
exports.updateServicePlan = [
  body("servicePlanId").isMongoId().withMessage("Invalid service plan ID"),
  body("isActiveSince").optional().notEmpty(),
  body("customerApprovalRequired").isBoolean(),
  body("subdivisionApprovalRequired").optional().isBoolean(),
  body("approverId")
    .optional({ values: "falsy" })
    .isMongoId()
    .withMessage("Некорректный идентификатор согласующего"),
];

exports.deleteServicePlan = [
  body("servicePlanId").isMongoId().withMessage("Invalid service plan ID"),
];

exports.createApiKey = [
  body("companyId").isMongoId().withMessage("Invalid company ID"),
  body("keyName")
    .trim()
    .notEmpty()
    .withMessage("API key name is required")
    .isLength({ min: 1, max: 100 })
    .withMessage("API key name must be between 1 and 100 characters"),
];

exports.deleteApiKey = [
  body("companyId").isMongoId().withMessage("Invalid company ID"),
  body("keyId").isMongoId().withMessage("Invalid API key ID"),
];

exports.reissueApiKey = [
  body("companyId").isMongoId().withMessage("Invalid company ID"),
  body("keyId").isMongoId().withMessage("Invalid API key ID"),
];

exports.getCompanyLogs = [
  param("id").isMongoId().withMessage("Invalid company ID"),
];

exports.linkUserToAD = [
  body("activeDirectoryObjectGUID")
    .trim()
    .notEmpty()
    .withMessage("Active Directory Object GUID is required"),
  body("userId").isMongoId().withMessage("Invalid user ID"),
];

exports.unlinkUserFromAD = [
  body("userId").isMongoId().withMessage("Invalid user ID"),
];
