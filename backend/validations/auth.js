const { body } = require("express-validator");

// Осталась одна проверка: саморегистрация, первый запуск и восстановление
// пароля удалены — первое и второе как класс, третье переехало на ручки
// better-auth, у которых своя валидация.
exports.login = [
  body("email").isEmail().withMessage("Некорректный E-Mail адрес"),
  body("password").trim().notEmpty().withMessage("Введите пароль"),
];
