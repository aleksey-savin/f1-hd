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
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("Некорректный ID компании"),
  // Компания обязательна для самостоятельного устройства; компонент наследует её
  // от родителя. Отдельная цепочка без optional — выполняется всегда.
  body("companyId").custom((value, { req }) => {
    if (!value && !req.body.parentDeviceId) {
      throw new Error("Компания обязательна");
    }
    return true;
  }),
  body("deviceModelId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("Некорректный ID модели устройства"),
  body("deviceTypeId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("Некорректный ID типа устройства"),
  // Устройство задаётся моделью (заводская сборка) ИЛИ типом (самосборное). Отдельная
  // цепочка без optional — иначе при пустой модели проверка была бы пропущена.
  body("deviceModelId").custom((value, { req }) => {
    if (!value && !req.body.deviceTypeId) {
      throw new Error("Укажите модель или тип устройства");
    }
    return true;
  }),
  body("userId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("Некорректный ID пользователя"),
  body("locationId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("Некорректный ID расположения"),
  body("serialNumber")
    .optional({ checkFalsy: true })
    .isLength({ min: 1, max: 100 })
    .withMessage("Серийный номер должен содержать от 1 до 100 символов")
    .trim(),
  body("hostname")
    .optional({ checkFalsy: true })
    .isLength({ max: 100 })
    .withMessage("Имя компьютера не должно превышать 100 символов")
    .trim(),
  body("inventoryNumber")
    .optional({ checkFalsy: true })
    .isLength({ max: 100 })
    .withMessage("Инвентарный номер не должен превышать 100 символов")
    .trim(),
  body("parentDeviceId")
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage("Некорректный ID родительского устройства"),
  body("quantity")
    .optional({ checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage("Количество должно быть целым числом не менее 1"),
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
