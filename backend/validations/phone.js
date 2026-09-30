const { body } = require("express-validator");

const { parsePhoneInput, isValidPhone } = require("../services/phone");

// Телефоны на входе API: что бы ни прислали (веб шлёт «+цифры», старая вкладка
// после деплоя — маску или «8…»), в req.body остаются цифры с кодом страны
// (services/phone.js). Пустая строка — «телефона нет», это не ошибка.
const PHONE_MESSAGE =
  "Проверьте номер телефона: нужен полный номер с кодом страны и города";

const phoneBody = (path) =>
  body(path)
    .optional({ values: "null" })
    .customSanitizer((value) => parsePhoneInput(value))
    .custom((value) => value === "" || isValidPhone(value))
    .withMessage(PHONE_MESSAGE);

// Телефоны компании: массив (tw-форма) или одна строка (легаси); пустые строки
// и повторы выпадают, нестроковый элемент — ошибка
const phoneListBody = (path) =>
  body(path)
    .optional({ values: "null" })
    .customSanitizer((value) => {
      const list = Array.isArray(value) ? value : [value];
      const parsed = list.map((item) => (typeof item === "string" ? parsePhoneInput(item) : item));
      return [...new Set(parsed.filter((item) => item !== ""))];
    })
    .custom((list) => list.every((item) => typeof item === "string" && isValidPhone(item)))
    .withMessage(PHONE_MESSAGE);

module.exports = { phoneBody, phoneListBody, PHONE_MESSAGE };
