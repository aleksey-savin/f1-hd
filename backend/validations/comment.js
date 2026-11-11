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
  body("content").trim().custom((value, { req }) => Boolean(value) || Boolean(req.files?.length))
    .withMessage("Напишите сообщение или прикрепите файл"),
];

exports.delete = [
  param("commentId")
    .trim()
    .notEmpty()
    .withMessage("Comment ID is required")
    .isMongoId()
    .withMessage("Invalid Comment ID"),
];
