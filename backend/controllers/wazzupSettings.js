const { AppError } = require('../middleware/errorHandling');
const configuration = require('../services/wazzup/configuration');
const provider = require('../services/wazzup/provider');
exports.get = async (req, res, next) => {
  try {
    if (req.auth?.isEndUser || !req.auth?.can?.({ settings: ['manage'] })) throw new AppError('Недостаточно прав для просмотра Wazzup', 403);
    res.status(200).json({ wazzup: await configuration.loadConfiguration() });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError('Не удалось загрузить настройки Wazzup', 500));
  }
};
exports.check = async (req, res, next) => {
  try {
    if (req.auth?.isEndUser || !req.auth?.can?.({ settings: ['manage'] })) throw new AppError('Недостаточно прав для проверки Wazzup', 403);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new AppError('Некорректные настройки Wazzup', 422);
    const apiKey = await configuration.resolveKey(req.body.apiKey);
    const accounts = await provider.fetchAccounts(apiKey);
    await configuration.recordSuccessfulCheck(apiKey);
    res.status(200).json({ accounts, message: 'Подключение к Wazzup проверено' });
  } catch (error) {
    next(configuration.safeProviderError(error));
  }
};
