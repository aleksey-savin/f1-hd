const { body } = require("express-validator");

const clientDeviceValidation = [
  body("company")
    .notEmpty()
    .withMessage("Компания обязательна")
    .isMongoId()
    .withMessage("Некорректный ID компании"),
  body("user")
    .optional()
    .isMongoId()
    .withMessage("Некорректный ID пользователя"),
  body("location")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Расположение не должно превышать 200 символов")
    .trim(),
  body("deviceType")
    .notEmpty()
    .withMessage("Тип устройства обязателен")
    .isMongoId()
    .withMessage("Некорректный ID типа устройства"),
  body("vendor")
    .notEmpty()
    .withMessage("Вендор обязателен")
    .isMongoId()
    .withMessage("Некорректный ID вендора"),
  body("model")
    .notEmpty()
    .withMessage("Модель обязательна")
    .isLength({ min: 1, max: 100 })
    .withMessage("Модель должна содержать от 1 до 100 символов")
    .trim(),
  body("serialNumber")
    .notEmpty()
    .withMessage("Серийный номер обязателен")
    .isLength({ min: 1, max: 100 })
    .withMessage("Серийный номер должен содержать от 1 до 100 символов")
    .trim(),
  body("purchaseDate")
    .optional()
    .isDate()
    .withMessage("Некорректная дата приобретения"),
  body("price").optional().isNumeric().withMessage("Цена должна быть числом"),
  body("purchaseDocument")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Документ не должен превышать 200 символов")
    .trim(),
  body("warrantyExpirationDate")
    .optional()
    .isDate()
    .withMessage("Некорректная дата окончания гарантии"),
  body("status")
    .optional()
    .isIn(["Готово к выдаче", "Выдано", "В ремонте", "Списано"])
    .withMessage("Некорректный статус устройства"),
  body("lastMaintenanceDate")
    .optional()
    .isDate()
    .withMessage("Некорректная дата последнего обслуживания"),
  body("notes")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Заметки не должны превышать 1000 символов")
    .trim(),
  body("assignedTo")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Назначен не должно превышать 200 символов")
    .trim(),
  body("ipAddress").optional().isIP().withMessage("Некорректный IP-адрес"),
  body("macAddress")
    .optional()
    .isMACAddress()
    .withMessage("Некорректный MAC-адрес"),
  body("operatingSystem")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Операционная система не должна превышать 100 символов")
    .trim(),
];

module.exports = {
  clientDeviceValidation,
};
