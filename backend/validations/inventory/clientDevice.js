const { body } = require("express-validator");

const STATUS_VALUES = [
  "readyForDeployment",
  "deployed",
  "inRepair",
  "decommissioned",
  "inReserve",
  "disposed",
];

// Note: the form submits "" for empty optional fields, so optional rules use
// { checkFalsy: true } to treat blanks as absent rather than failing format checks.
const clientDeviceValidation = [
  body("companyId")
    .notEmpty()
    .withMessage("Компания обязательна")
    .isMongoId()
    .withMessage("Некорректный ID компании"),
  body("deviceModelId")
    .notEmpty()
    .withMessage("Модель устройства обязательна")
    .isMongoId()
    .withMessage("Некорректный ID модели устройства"),
  body("userId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("Некорректный ID пользователя"),
  body("locationId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("Некорректный ID расположения"),
  body("serialNumber")
    .notEmpty()
    .withMessage("Серийный номер обязателен")
    .isLength({ min: 1, max: 100 })
    .withMessage("Серийный номер должен содержать от 1 до 100 символов")
    .trim(),
  body("status")
    .optional({ checkFalsy: true })
    .isIn(STATUS_VALUES)
    .withMessage("Некорректный статус устройства"),
  body("price")
    .optional({ checkFalsy: true })
    .isNumeric()
    .withMessage("Цена должна быть числом"),
  body("purchaseDocument")
    .optional({ checkFalsy: true })
    .isLength({ max: 200 })
    .withMessage("Документ не должен превышать 200 символов")
    .trim(),
  body("supplierId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("Некорректный ID поставщика"),
  body("purchasedAt")
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage("Некорректная дата приобретения"),
  body("warrantyExpirationDate")
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage("Некорректная дата окончания гарантии"),
  body("lastMaintenanceDate")
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage("Некорректная дата последнего обслуживания"),
  body("notes")
    .optional({ checkFalsy: true })
    .isLength({ max: 1000 })
    .withMessage("Заметки не должны превышать 1000 символов")
    .trim(),
  body("ipAddress")
    .optional({ checkFalsy: true })
    .isIP()
    .withMessage("Некорректный IP-адрес"),
  body("macAddress")
    .optional({ checkFalsy: true })
    .isMACAddress()
    .withMessage("Некорректный MAC-адрес"),
  body("operatingSystem")
    .optional({ checkFalsy: true })
    .isLength({ max: 100 })
    .withMessage("Операционная система не должна превышать 100 символов")
    .trim(),
];

module.exports = {
  clientDeviceValidation,
};
