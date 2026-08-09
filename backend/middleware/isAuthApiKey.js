const Company = require("../models/company");
const { AppError } = require("./errorHandling");
const { hashApiKey } = require("../utils/apiKeyGenerator");

/**
 * Проверка API-ключа компании (заголовок `X-API-Key`).
 *
 * СРАВНИВАЕТСЯ ОТПЕЧАТОК, а не значение: ключ хранился строкой, и любая
 * выгрузка базы давала готовый доступ на заведение заявок от имени компании.
 *
 * Пока идёт переход, поиск идёт по обоим полям: у ключей, до которых миграция
 * ещё не дошла, `keyHash` пуст. Ветка со значением уходит вместе с самим полем
 * — тогда же, когда каждый живой ключ докажет, что проходит по отпечатку.
 */

/**
 * Отметка «когда работал» пишется не чаще раза в час.
 *
 * Она нужна, чтобы отличить живой ключ от забытого, и точность до часа для
 * этого избыточна с запасом. Писать на каждый запрос значило бы обновлять
 * документ компании на каждое обращение интеграции — у AD это каждый вход в
 * домен.
 */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

const touch = async (companyId, keyId, lastUsedAt) => {
  if (lastUsedAt && Date.now() - new Date(lastUsedAt).getTime() < TOUCH_EVERY_MS) {
    return;
  }
  await Company.updateOne(
    { _id: companyId, "apiKeys._id": keyId },
    { $set: { "apiKeys.$.lastUsedAt": new Date() } },
  );
};

module.exports = async (req, res, next) => {
  try {
    const apiKey =
      req.get("X-API-Key") || req.get("Authorization")?.replace("ApiKey ", "");

    if (!apiKey) {
      return next(new AppError("API-ключ не предоставлен", 401));
    }

    const hash = hashApiKey(apiKey);

    // Ключи отключённой компании не работают (isActive: $ne false — у старых
    // документов поля нет).
    const company = await Company.findOne({
      isActive: { $ne: false },
      apiKeys: {
        $elemMatch: {
          isActive: true,
          $or: [{ keyHash: hash }, { key: apiKey }],
        },
      },
    });

    if (!company) {
      return next(new AppError("Недействительный API-ключ", 401));
    }

    const apiKeyObject = company.apiKeys.find(
      (item) => item.isActive && (item.keyHash === hash || item.key === apiKey),
    );

    if (!apiKeyObject) {
      return next(new AppError("API-ключ деактивирован", 401));
    }

    // Отметка не должна ломать запрос: интеграция пришла за делом, а не за
    // обновлением статистики.
    touch(company._id, apiKeyObject._id, apiKeyObject.lastUsedAt).catch(
      () => {},
    );

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
    next(new AppError("Ошибка при проверке API-ключа", 500, true, error));
  }
};
