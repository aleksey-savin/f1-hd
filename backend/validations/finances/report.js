const { body } = require("express-validator");

exports.confirmWorksByContractor = [
  body("relatedWorks").isArray().withMessage("Related works must be an array"),
  body("companyId")
    .notEmpty()
    .withMessage("Company ID is required")
    .isMongoId()
    .withMessage("Company ID must be a valid MongoDB ID"),
  body("servicePlanId")
    .notEmpty()
    .withMessage("Service plan ID is required")
    .isMongoId()
    .withMessage("Service plan ID must be a valid MongoDB ID"),
  body("price")
    .notEmpty()
    .withMessage("Price is required")
    .isNumeric()
    .withMessage("Price must be a number"),
  body("additionalPrice")
    .isNumeric()
    .withMessage("Additional price must be a number"),
];

exports.createInvoice = [
  body("reportId")
    .notEmpty()
    .withMessage("Report ID is required")
    .isMongoId()
    .withMessage("Report ID must be a valid MongoDB ID"),
  body("invoiceNumber")
    .notEmpty()
    .withMessage("Invoice number is required")
    .isString()
    .withMessage("Invoice number must be a string"),
  body("invoiceDate")
    .notEmpty()
    .withMessage("Date is required")
    .isDate()
    .withMessage("Invalid date format"),
];

exports.confirmPayment = [
  body("reportId")
    .notEmpty()
    .withMessage("Report ID is required")
    .isMongoId()
    .withMessage("Report ID must be a valid MongoDB ID"),
  body("fullPaymentDate")
    .notEmpty()
    .withMessage("Date is required")
    .isDate()
    .withMessage("Invalid date format"),
];

exports.delete = [
  body("reportId")
    .notEmpty()
    .withMessage("Report ID is required")
    .isMongoId()
    .withMessage("Report ID must be a valid MongoDB ID"),
];

exports.archive = [
  body("reportId")
    .notEmpty()
    .withMessage("Report ID is required")
    .isMongoId()
    .withMessage("Report ID must be a valid MongoDB ID"),
];

exports.employeeReport = [
  body("periodFrom")
    .notEmpty()
    .withMessage("Period start date is required")
    .isDate()
    .withMessage("Invalid start date format"),
  body("periodTo")
    .notEmpty()
    .withMessage("Period end date is required")
    .isDate()
    .withMessage("Invalid end date format"),
];
