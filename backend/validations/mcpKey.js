const { body } = require("express-validator");
const { MCP_SCOPES } = require("../services/mcp/keys");

// Ключи ИИ-агентов к базе знаний (Настройки, routes/internal/preferences.js).
// Название обрезается здесь: контроллер ищет дубликат уже по обрезанному.

const scopesRule = (chain) =>
  chain
    .isArray({ min: 1 })
    .withMessage("Отметьте, к чему у ключа доступ")
    .bail()
    .custom((scopes) => scopes.every((scope) => MCP_SCOPES.includes(scope)))
    .withMessage("Неизвестный доступ ключа");

exports.create = [
  body("name")
    .isString()
    .withMessage("Укажите название ключа")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Укажите название ключа")
    .bail()
    .isLength({ max: 100 })
    .withMessage("Название ключа — не длиннее 100 знаков"),
  scopesRule(body("scopes").optional()),
];

exports.remove = [
  body("_id").isMongoId().withMessage("Некорректный идентификатор ключа"),
];

exports.update = [
  body("_id").isMongoId().withMessage("Некорректный идентификатор ключа"),
  scopesRule(body("scopes")),
];
