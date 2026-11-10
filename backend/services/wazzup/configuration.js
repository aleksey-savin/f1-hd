const crypto = require('node:crypto');
const net = require('node:net');
const WazzupSettings = require('../../models/wazzupSettings');
const Channel = require('../../models/channel');
const { toCanonicalPhone, isValidPhone } = require('../phone');
const { encryptSecret, decryptSecret } = require('../crypto/secretBox');
const { AppError } = require('../../middleware/errorHandling');

const accountFields = ['id', 'type', 'transport', 'name', 'account', 'state', 'reason'];
const healthFields = ['lastCheckedAt', 'lastOkAt', 'lastMessageAt', 'lastError', 'lastErrorHint', 'lastErrorAt'];
const pick = (value, fields) => Object.fromEntries(fields.filter((field) => value?.[field] !== undefined).map((field) => [field, value[field]]));
const publicConfiguration = (settings) => ({
  isActive: Boolean(settings?.isActive),
  apiKeyIsSet: Boolean(settings?.apiKey),
  channelIds: settings?.channelIds || [],
  accounts: (settings?.accounts || []).map((account) => pick(account, accountFields)),
  health: pick(settings?.health, healthFields),
  webhookConnected: Boolean(settings?.webhookConnected),
});
const readConfiguration = () => WazzupSettings.findById('wazzup').select('+apiKey +webhookToken').lean();
const loadConfiguration = async () => publicConfiguration(await readConfiguration());
const readSecret = (ciphertext, label) => {
  try { return ciphertext ? decryptSecret(ciphertext) : ''; }
  catch { throw new AppError(`Сохранённый ${label} Wazzup не читается — сохраните API-ключ заново`, 422); }
};
const writeSecret = (value) => {
  try { return encryptSecret(value); }
  catch { throw new AppError('Не настроен ключ шифрования APP_ENC_KEY', 422); }
};
const resolveKey = async (apiKey, current) => {
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 4096)) throw new AppError('Некорректный API-ключ Wazzup', 422);
  const key = apiKey?.trim() || readSecret((current || await readConfiguration())?.apiKey, 'API-ключ');
  if (!key) throw new AppError('Укажите API-ключ Wazzup', 422);
  return key;
};
const successfulHealth = () => {
  const now = new Date();
  return { 'health.lastCheckedAt': now, 'health.lastOkAt': now, 'health.lastError': '', 'health.lastErrorHint': '', 'health.lastErrorAt': null };
};
const recordSuccessfulCheck = async (apiKey) => {
  const current = await readConfiguration();
  if (!current?.apiKey) return;
  let savedKey;
  try { savedKey = decryptSecret(current.apiKey); } catch { return; }
  if (savedKey !== apiKey) return;
  // A concurrent credential replacement must not inherit this key's success.
  await WazzupSettings.updateOne({ _id: 'wazzup', apiKey: current.apiKey }, { $set: successfulHealth() });
};
// Never pass raw transport errors to the response or the logger: they may carry
// the Authorization header or a callback URL with its token.
const safeProviderError = (error) => error instanceof AppError
  ? error
  : error instanceof require('./provider').ProviderError
    ? new AppError(error.message, error.statusCode)
    : new AppError('Не удалось связаться с Wazzup. Проверьте API-ключ и доступность сервиса', 502);
const callbackBase = () => {
  let url;
  try { url = new URL(process.env.APP_PUBLIC_URL || process.env.ADDRESS || ''); } catch { /* validation below */ }
  const host = url?.hostname.toLowerCase();
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || net.isIP(host?.replace(/^\[|\]$/g, '')) || !host?.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new AppError('Для Wazzup задайте публичный HTTPS-адрес HD в APP_PUBLIC_URL или ADDRESS', 422);
  }
  return new URL('/api/wazzup/webhook', url.origin);
};
const accountPhone = (value) => {
  const text = String(value || '').trim();
  if (!/^[+\d\s().-]+$/.test(text)) return '';
  const phone = toCanonicalPhone(text);
  return isValidPhone(phone) ? phone : '';
};
const accountUsername = (value) => {
  const username = String(value || '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z_][a-z0-9_]{0,63}$/.test(username) ? username : '';
};
const rejectDirectDuplicates = async (accounts) => {
  const direct = await Channel.find({ isActive: true, provider: { $ne: 'wazzup' }, state: { $nin: ['loggedOut', 'disconnected'] }, type: { $in: [...new Set(accounts.map((account) => account.type))] } }).select('type account.phone account.username').lean();
  for (const account of accounts) {
    const phone = accountPhone(account.account);
    const username = accountUsername(account.account);
    if (direct.some((channel) => channel.type === account.type && (
      (phone && phone === accountPhone(channel.account?.phone)) ||
      (username && username === accountUsername(channel.account?.username))
    ))) throw new AppError('Этот аккаунт уже подключён напрямую — отключите прямое подключение перед подключением через Wazzup', 409);
  }
};
const prepareConfiguration = async (draft) => {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new AppError('Некорректные настройки Wazzup', 422);
  const current = await readConfiguration() || {};
  const isActive = draft.isActive === undefined ? (current.isActive ?? false) : draft.isActive;
  const channelIds = draft.channelIds === undefined ? (current.channelIds ?? []) : draft.channelIds;
  if (typeof isActive !== 'boolean' || !Array.isArray(channelIds) || channelIds.length > 200 || channelIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200) || new Set(channelIds).size !== channelIds.length) throw new AppError('Некорректный список аккаунтов Wazzup', 422);
  if (draft.apiKey !== undefined && (typeof draft.apiKey !== 'string' || draft.apiKey.length > 4096)) throw new AppError('Некорректный API-ключ Wazzup', 422);
  const next = { isActive, channelIds: [...channelIds], apiKey: draft.apiKey?.trim() ? writeSecret(draft.apiKey.trim()) : current.apiKey };
  if (isActive) {
    if (!channelIds.length) throw new AppError('Выберите хотя бы один аккаунт Wazzup', 422);
    callbackBase();
    const key = await resolveKey(undefined, next);
    try { next.accounts = await require('./provider').fetchAccounts(key); }
    catch (error) { throw safeProviderError(error); }
    if (channelIds.some((id) => !next.accounts.some((account) => account.id === id))) throw new AppError('Выбранный аккаунт отсутствует в Wazzup. Проверьте подключение и выберите аккаунты заново', 422);
    await rejectDirectDuplicates(next.accounts.filter((account) => channelIds.includes(account.id)));
  }
  return next;
};
const saveConfiguration = async (prepared) => {
  if (prepared.isActive) {
    const provider = require('./provider');
    const apiKey = await resolveKey(undefined, prepared);
    const current = await readConfiguration();
    let token = current?.webhookToken ? readSecret(current.webhookToken, 'токен вебхука') : crypto.randomBytes(32).toString('base64url');
    const callback = callbackBase();
    callback.searchParams.set('token', token);
    let remote;
    try { remote = await provider.getWebhooks(apiKey); } catch (error) { throw safeProviderError(error); }
    if (!remote || !Object.prototype.hasOwnProperty.call(remote, 'webhooksUri') || (remote.webhooksUri !== null && typeof remote.webhooksUri !== 'string')) throw new AppError('Wazzup вернул неизвестное состояние вебхука. Проверьте подключение в Wazzup', 502);
    if (remote.webhooksUri && remote.webhooksUri !== callback.href) throw new AppError('В Wazzup уже подключён вебхук другой интеграции. Освободите его в Wazzup перед подключением HD', 409);
    // The provider synchronously probes the callback. Store only the token at
    // this point; failed registration must not replace working credentials.
    if (!current?.webhookToken) {
      const candidate = writeSecret(token);
      // Concurrent initial saves converge on the token of the first insert.
      let stored = await WazzupSettings.findOneAndUpdate({ _id: 'wazzup' }, { $setOnInsert: { webhookToken: candidate, isActive: false } }, { upsert: true, new: true }).select('+webhookToken').lean();
      if (!stored.webhookToken) {
        stored = await WazzupSettings.findOneAndUpdate({ _id: 'wazzup', webhookToken: { $exists: false } }, { $set: { webhookToken: candidate } }, { new: true }).select('+webhookToken').lean() || await readConfiguration();
      }
      token = readSecret(stored.webhookToken, 'токен вебхука');
      callback.searchParams.set('token', token);
      if (remote.webhooksUri && remote.webhooksUri !== callback.href) throw new AppError('Настройки Wazzup изменились одновременно. Повторите сохранение', 409);
    }
    try {
      await provider.setWebhooks(apiKey, { webhooksUri: callback.href, subscriptions: { messagesAndStatuses: true, channelsUpdates: true, contactsAndDealsCreation: false } });
    } catch (error) { throw safeProviderError(error); }
  }
  const fields = { isActive: prepared.isActive, channelIds: prepared.channelIds };
  if (prepared.apiKey !== undefined) fields.apiKey = prepared.apiKey;
  if (prepared.accounts) fields.accounts = prepared.accounts.map((account) => pick(account, accountFields));
  if (prepared.isActive) Object.assign(fields, { webhookConnected: true }, successfulHealth());
  const saved = await WazzupSettings.findOneAndUpdate({ _id: 'wazzup' }, { $set: fields }, { upsert: true, new: true }).select('+apiKey +webhookToken').lean();
  await require('./channels').syncChannels(saved);
  return publicConfiguration(saved);
};
module.exports = { loadConfiguration, prepareConfiguration, saveConfiguration, resolveKey, recordSuccessfulCheck, publicConfiguration, safeProviderError };
