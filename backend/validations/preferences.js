const { body } = require("express-validator");

// Настройки сохраняются ПО СЕКЦИЯМ: в теле приходит только изменённая группа,
// поэтому каждое правило optional — иначе сохранение «Модулей» падало бы на
// пустом адресе почты. Смысловые инварианты включённых каналов (адрес, сервер,
// пароль, инициатор) проверяет контроллер: они зависят от того, что уже лежит
// в БД, а не только от тела запроса.
//
// Ранее этот файл ни к одному роуту подключён не был — правила ссылались на
// несуществующее поле htmlDesc и не исполнялись.

const optionalText = (path, max) =>
  body(path)
    .optional()
    .isString()
    .withMessage(`Поле ${path} должно быть строкой`)
    .isLength({ max })
    .withMessage(`Поле ${path} длиннее ${max} символов`);

const optionalPort = (path) =>
  body(path)
    .optional({ values: "falsy" })
    .isInt({ min: 1, max: 65535 })
    .withMessage("Порт должен быть числом от 1 до 65535");

const optionalEmail = (path, message) =>
  body(path)
    .optional({ values: "falsy" })
    .isEmail()
    .withMessage(message);

exports.update = [
  optionalText("timezone", 50),
  body("htmlTicketDesc").optional().isBoolean(),
  body("deadline").optional().isNumeric(),
  body("contacts").optional().isObject(),
  body("taxi").optional().isObject(),

  // Ящик-приёмник
  body("mailbox").optional().isObject(),
  body("mailbox.isActive").optional().isBoolean(),
  optionalEmail("mailbox.address", "Адрес почтового ящика указан неверно"),
  optionalText("mailbox.host", 255),
  optionalPort("mailbox.port"),
  body("mailbox.security")
    .optional()
    .isIn(["ssl", "starttls", "none"])
    .withMessage("Неизвестный режим шифрования IMAP"),
  optionalText("mailbox.folder", 255),
  body("mailbox.allowSelfSigned").optional().isBoolean(),

  body("defaultApplicant").optional().isObject(),
  body("defaultCompany").optional().isObject(),
  body("identifyCompany").optional().isBoolean(),
  body("identifyApplicant").optional().isBoolean(),
  body("checkPhoneNumber").optional().isBoolean(),

  // Канал уведомлений
  body("notify").optional().isObject(),
  optionalText("notify.byEmail.host", 255),
  optionalPort("notify.byEmail.port"),
  body("notify.byEmail.security")
    .optional()
    .isIn(["ssl", "starttls", "none"])
    .withMessage("Неизвестный режим шифрования SMTP"),
  body("notify.byEmail.authMethod")
    .optional()
    .isIn(["password", "none"])
    .withMessage("Неизвестный способ авторизации SMTP"),
  body("notify.byEmail.allowSelfSigned").optional().isBoolean(),
  optionalEmail("notify.byEmail.sendFromEmail", "Адрес отправителя указан неверно"),

  body("getScreen").optional().isObject(),
  body("modules").optional().isObject(),
  body("knowledgeBase").optional().isObject(),
  body("mikrotik").optional().isObject(),
  body("ai").optional().isObject(),
  body("overtime").optional().isObject(),
  body("productionCalendar").optional().isObject(),
  body("productionCalendar.isActive").optional().isBoolean(),
  body("productionCalendar.country")
    .optional()
    .isIn(["ru", "by", "kz", "uz"])
    .withMessage("Для этой страны производственный календарь не поддерживается"),
  body("productionCalendar.source")
    .optional()
    .isIn(["xmlcalendar", "isdayoff"])
    .withMessage("Неизвестный источник календаря"),
  body("statusBoard").optional().isObject(),
];
