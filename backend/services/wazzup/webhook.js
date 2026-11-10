const crypto = require('node:crypto');
const { eventKey } = require('./events');
const KINDS = ['messages', 'statuses', 'channelsUpdates'];
const tokensMatch = (expected, received) => {
  if (typeof expected !== 'string' || !expected || typeof received !== 'string') return false;
  const a = Buffer.from(expected), b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const load = async () => {
  const settings = await require('../../models/wazzupSettings').findById('wazzup').select('+webhookToken').lean();
  if (!settings?.webhookToken) return null;
  return { isActive: settings.isActive, token: require('../crypto/secretBox').decryptSecret(settings.webhookToken) };
};
const enqueue = async (kind, raw) => {
  const WazzupEvent = require('../../models/wazzupEvent');
  try {
    await WazzupEvent.updateOne({ _id: eventKey(kind, raw) }, { $setOnInsert: { kind, payload: raw, notBefore: new Date(Date.now() + 250) } }, { upsert: true });
  } catch (error) { if (error?.code !== 11000) throw error; }
};
const createWebhook = ({ load: read = load, enqueue: persist = enqueue } = {}) => async (req, res) => {
  try {
    const settings = await read();
    if (!tokensMatch(settings?.token, req.query.token)) return res.status(401).json({ message: 'Некорректный токен Wazzup' });
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ message: 'Некорректный вебхук Wazzup' });
    if (body.test === true) return res.status(200).json({ ok: true });
    if (!settings.isActive) return res.status(200).json({ ok: true, ignored: true });
    let count = 0;
    for (const kind of KINDS) {
      if (body[kind] === undefined) continue;
      if (!Array.isArray(body[kind]) || body[kind].some(item => !item || typeof item !== 'object' || Array.isArray(item))) return res.status(400).json({ message: 'Некорректные события Wazzup' });
      count += body[kind].length;
    }
    if (!count || count > 500) return res.status(400).json({ message: 'Ожидается от 1 до 500 событий Wazzup' });
    for (const kind of KINDS) for (const raw of body[kind] || []) await persist(kind, raw);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ message: 'Не удалось принять события Wazzup — повторите доставку' });
  }
};
module.exports = { createWebhook, tokensMatch };
