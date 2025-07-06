const { body, param } = require("express-validator");

exports.get = [
  param("ticketNum").trim().notEmpty().withMessage("Ticket Number is required"),
];

exports.add = [
  body("ticketId")
    .trim()
    .notEmpty()
    .withMessage("Ticket ID is required")
    .isMongoId()
    .withMessage("Invalid Ticket ID"),
  body("content").trim().notEmpty().withMessage("Content is required"),
];

exports.delete = [
  param("commentId")
    .trim()
    .notEmpty()
    .withMessage("Comment ID is required")
    .isMongoId()
    .withMessage("Invalid Comment ID"),
];
