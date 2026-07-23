const jwt = require("jsonwebtoken");
const Company = require("../models/company");
const { AppError } = require("./errorHandling");

/**
 * Middleware для проверки API-ключей компаний
 * Проверяет заголовок X-API-Key и устанавливает информацию о компании в req.company
 */
module.exports = async (req, res, next) => {
  try {
    const apiKey = req.get("X-API-Key") || req.get("Authorization")?.replace("ApiKey ", "");

    if (!apiKey) {
      return next(new AppError("API-ключ не предоставлен", 401));
    }

    // Ищем компанию с данным API-ключом; ключи отключённой компании не
    // работают (isActive: $ne false — у старых документов поля нет)
    const company = await Company.findOne({
      "apiKeys.key": apiKey,
      "apiKeys.isActive": true,
      isActive: { $ne: false },
    });

    if (!company) {
      return next(new AppError("Недействительный API-ключ", 401));
    }

    // Находим конкретный API-ключ в массиве
    const apiKeyObject = company.apiKeys.find(
      (key) => key.key === apiKey && key.isActive
    );

    if (!apiKeyObject) {
      return next(new AppError("API-ключ деактивирован", 401));
    }

    // Устанавливаем информацию о компании и API-ключе в запрос
    req.company = {
      _id: company._id,
      alias: company.alias,
      fullTitle: company.fullTitle,
      apiKey: {
        _id: apiKeyObject._id,
        name: apiKeyObject.name,
        createdAt: apiKeyObject.createdAt,
      },
    };

    next();
  } catch (error) {
    next(new AppError("Ошибка аутентификации API-ключа", 500, true, error));
  }
};
