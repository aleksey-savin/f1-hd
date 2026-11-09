const { encryptSecret, decryptSecret } = require('../crypto/secretBox');
const { AppError } = require('../../middleware/errorHandling');
const defaults = { isActive: false, clientId: '', pollSeconds: 60, historyDays: 14 };
const keys = Object.keys(defaults);
const prepareSettings = (body, current = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Некорректные настройки', 400);
  const next = { ...defaults, ...Object.fromEntries(keys.filter((key) => current[key] !== undefined).map((key) => [key, current[key]])), token: current.token };
  for (const key of keys) if (body[key] !== undefined) next[key] = body[key];
  if (typeof next.isActive !== 'boolean' || !Number.isInteger(next.pollSeconds) || next.pollSeconds < 30 || next.pollSeconds > 3600 || !Number.isInteger(next.historyDays) || next.historyDays < 1 || next.historyDays > 365) throw new AppError('Некорректные параметры синхронизации', 400);
  for (const key of ['clientId']) {
    if (typeof next[key] !== 'string' || next[key].length > 200) throw new AppError('Некорректные параметры Яндекс Go', 400);
    next[key] = next[key].trim();
  }
  if (body.token !== undefined && typeof body.token !== 'string') throw new AppError('Некорректный токен', 400);
  if (body.token?.trim()) {
    try { next.token = encryptSecret(body.token.trim()); } catch { throw new AppError('Не настроен ключ шифрования APP_ENC_KEY', 400); }
  }
  if (next.isActive) {
    if (!next.clientId || !next.token) throw new AppError('Укажите токен и ID клиента Яндекс Go', 400);
    try { if (!decryptSecret(next.token)) throw new Error(); } catch { throw new AppError('Токен Яндекс Go недоступен; проверьте ключ шифрования и сохраните токен снова', 400); }
  }
  return next;
};
const publicSettings = (settings) => ({ ...Object.fromEntries(keys.map((key) => [key, settings?.[key] ?? defaults[key]])), tokenIsSet: Boolean(settings?.token), health: settings?.health || {}, lastSyncAt: settings?.lastSyncAt || null });
const loadConfiguration = async () => {
  const { TaxiSettings, TaxiEmployee } = require('../../models/taxi');
  const User = require('../../models/user');
  const [settings, employees, users] = await Promise.all([
    TaxiSettings.findById('yandex-business').select('+token').lean(),
    TaxiEmployee.find({}).sort({ lastName: 1 }).lean(),
    User.find({ isEndUser: false, isServiceAccount: { $ne: true }, isCloudTelephony: { $ne: true }, deletedAt: null, banned: { $ne: true } }).select('firstName lastName email').sort({ lastName: 1 }).lean(),
  ]);
  return { settings: publicSettings(settings), employees, users };
};
const prepareConfiguration = async (body) => {
  const { TaxiSettings } = require('../../models/taxi');
  const current = await TaxiSettings.findById('yandex-business').select('+token').lean();
  return prepareSettings(body, current || {});
};
const saveConfiguration = async (next) => {
  const { TaxiSettings } = require('../../models/taxi');
  const settings = await TaxiSettings.findOneAndUpdate({ _id: 'yandex-business' }, { $set: next }, { upsert: true, new: true }).select('+token').lean();
  return publicSettings(settings);
};
module.exports = { prepareSettings, publicSettings, loadConfiguration, prepareConfiguration, saveConfiguration };
