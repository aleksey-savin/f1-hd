const { body } = require("express-validator");

const supplierValidation = [
  body("name")
    .notEmpty()
    .withMessage("Название поставщика обязательно")
    .isLength({ min: 2, max: 100 })
    .withMessage("Название должно содержать от 2 до 100 символов")
    .trim(),
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("Поле isActive должно быть булевым значением"),
  body("email")
    .optional({ values: "falsy" })
    .isEmail()
    .withMessage("Проверьте адрес почты")
    .trim(),
  // ИНН — 10 цифр у организации, 12 у ИП; КПП — всегда 9.
  body("inn")
    .optional({ values: "falsy" })
    .matches(/^(\d{10}|\d{12})$/)
    .withMessage("ИНН — 10 цифр у организации или 12 у ИП")
    .trim(),
  body("kpp")
    .optional({ values: "falsy" })
    .matches(/^\d{9}$/)
    .withMessage("КПП — 9 цифр")
    .trim(),
];

module.exports = {
  supplierValidation,
};
