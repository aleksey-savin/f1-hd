const { body, param } = require("express-validator");

exports.getOne = [
  param("ticketNum").isNumeric().withMessage("Ticket number must be numeric"),
];

exports.add = [
  body("title").trim().not().isEmpty().withMessage("Ticket title is required"),
  body("description")
    .trim()
    .not()
    .isEmpty()
    .withMessage("Ticket description is required"),
  body("categoryId").isMongoId().withMessage("Invalid category ID"),
  body("company._id").isMongoId().withMessage("Invalid company ID"),
  body("applicantId")
    .optional()
    .isMongoId()
    .withMessage("Invalid applicant ID"),
  body("priority")
    .isIn(["Планируемый", "Низкий", "Средний", "Высокий", "Критический"])
    .withMessage("Invalid priority value"),
];

exports.update = [
  body("id").isMongoId().withMessage("Invalid ticket ID"),
  body("title")
    .optional()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Ticket title cannot be empty if provided"),
  body("description")
    .optional()
    .trim()
    .not()
    .isEmpty()
    .withMessage("Ticket description cannot be empty if provided"),
  body("categoryId").optional().isMongoId().withMessage("Invalid category ID"),
  body("company._id").optional().isMongoId().withMessage("Invalid company ID"),
  body("priority")
    .optional()
    .isIn(["Планируемый", "Низкий", "Средний", "Высокий", "Критический"])
    .withMessage("Invalid priority value"),
];

exports.process = [body("ticket").isMongoId().withMessage("Invalid ticket ID")];

exports.takeToWork = [
  body("ticket").isMongoId().withMessage("Invalid ticket ID"),
];

exports.requestHelp = [
  body("ticket").isMongoId().withMessage("Invalid ticket ID"),
  body("respId").isMongoId().withMessage("Invalid user ID"),
];

exports.joinResponsibles = [
  body("ticket").isMongoId().withMessage("Invalid ticket ID"),
];

exports.updateDeadline = [
  body("ticket").isMongoId().withMessage("Invalid ticket ID"),
  body("deadline").isISO8601().withMessage("Invalid date format for deadline"),
];

exports.reject = [
  body("ticket").isMongoId().withMessage("Invalid ticket ID"),
  body("reason")
    .trim()
    .not()
    .isEmpty()
    .withMessage("Rejection reason is required"),
];

exports.close = [
  body("ticket").isMongoId().withMessage("Invalid ticket ID"),
  body("comment")
    .trim()
    .not()
    .isEmpty()
    .withMessage("Closing comment is required"),
];

exports.backToWork = [
  body("ticket").isMongoId().withMessage("Invalid ticket ID"),
  body("comment")
    .trim()
    .not()
    .isEmpty()
    .withMessage("Comment for returning to work is required"),
];

exports.delete = [param("id").isMongoId().withMessage("Invalid ticket ID")];

exports.deleteMultiple = [
  body("tickets")
    .isArray()
    .withMessage("Tickets must be an array")
    .custom((tickets) => tickets.every((id) => /^[0-9a-fA-F]{24}$/.test(id)))
    .withMessage("All ticket IDs must be valid MongoDB ObjectID"),
];

exports.updateChecklist = [
  param("ticketNum").isNumeric().withMessage("Ticket number must be numeric"),
  body("checklist").isArray().withMessage("Checklist must be an array"),
];

exports.updateChecklistItem = [
  param("ticketNum").isNumeric().withMessage("Ticket number must be numeric"),
  body("itemIndex").isNumeric().withMessage("Item index must be numeric"),
  body("checked").isBoolean().withMessage("Checked status must be boolean"),
];
