const crypto = require('node:crypto');

const TRANSPORTS = { whatsapp: 'whatsapp', wapi: 'whatsapp', tgapi: 'telegram', telegram: 'telegram', max: 'max', maxbot: 'max' };
const CHAT_TYPES = { whatsapp: 'whatsapp', whatsgroup: 'whatsapp', telegram: 'telegram', telegroup: 'telegram', max: 'max', maxgroup: 'max' };
const DESCRIPTIONS = {
  active: ['connected', 'Подключён'], init: ['connecting', 'Подключается в Wazzup'],
  disabled: ['disconnected', 'Аккаунт отключён в Wazzup'], phoneUnavailable: ['error', 'Нет связи с телефоном — проверьте Wazzup'],
  qr: ['loggedOut', 'Требуется вход по QR-коду в Wazzup'], openElsewhere: ['loggedOut', 'Аккаунт открыт в другом месте — проверьте Wazzup'],
  notEnoughMoney: ['error', 'Оплатите аккаунт в Wazzup'], foreignphone: ['loggedOut', 'В Wazzup отсканирован код другого номера'],
  unauthorized: ['loggedOut', 'Войдите в аккаунт в Wazzup'], waitForPassword: ['loggedOut', 'Введите пароль входа в Wazzup'],
  onModeration: ['connecting', 'Аккаунт на модерации в Wazzup'], rejected: ['error', 'Аккаунт отклонён — проверьте Wazzup'],
};
const channelState = value => {
  const [state, reason] = DESCRIPTIONS[value] || ['error', 'Проверьте состояние аккаунта в Wazzup'];
  return { state, reason };
};
const normalizeAccount = raw => {
  if (!raw || typeof raw.channelId !== 'string' || !raw.channelId || !TRANSPORTS[raw.transport]) return null;
  const type = TRANSPORTS[raw.transport];
  const label = { whatsapp: 'WhatsApp', telegram: 'Telegram', max: 'MAX' }[type];
  return { id: raw.channelId, type, transport: raw.transport, name: String(raw.name || label).slice(0, 100), account: String(raw.plainId || '').slice(0, 200), state: String(raw.state || ''), reason: channelState(raw.state).reason };
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const eventKey = (kind, raw) => crypto.createHash('sha256').update(JSON.stringify([kind, canonical(raw)])).digest('hex');
const personId = (channel, id) => `wazzup:${channel.providerChannelId}:${id}`;
const publicName = raw => {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
  return /^[@+\d\s().-]+$/.test(name) ? '' : name;
};

/** Provider boundary -> existing messaging event contract. */
const normalizeMessage = (raw, channel, { own, attachments = [] } = {}) => {
  if (!raw || typeof raw !== 'object' || raw.channelId !== channel.providerChannelId || CHAT_TYPES[raw.chatType] !== channel.type) return null;
  if (typeof raw.messageId !== 'string' || !raw.messageId || raw.messageId.length > 200 || typeof raw.chatId !== 'string' || !raw.chatId || raw.chatId.length > 200) return null;
  if (typeof raw.isEcho !== 'boolean' || !Number.isFinite(Date.parse(raw.dateTime))) return null;
  const group = ['whatsgroup', 'telegroup', 'maxgroup'].includes(raw.chatType);
  const contact = raw.contact || {};
  const peer = { id: personId(channel, raw.chatId), name: publicName(contact.name), phone: channel.type === 'whatsapp' ? raw.chatId : String(contact.phone || ''), username: String(contact.username || '') };
  const chat = { id: raw.chatId, kind: group ? 'group' : 'direct', ...(!group ? { peer } : { title: String(raw.chatName || contact.name || '').slice(0, 300) }) };
  const base = { channelId: String(channel._id), at: raw.dateTime, chat };
  if (raw.isDeleted) return { ...base, type: 'message.deleted', messageIds: [raw.messageId] };
  if (raw.isEdited) return own?.origin === 'hd' ? null : { ...base, type: 'message.edited', message: { id: raw.messageId, text: typeof raw.text === 'string' ? raw.text : '', editedAt: new Date() } };
  // User API v3 does not document a group participant identity: contact is
  // chat metadata, authorId/authorName describe a CRM sender of an echo.
  // Never turn the group or an invented ':unknown' key into a person. The
  // partner API's separate sender contract needs its own verified adapter.
  const sender = group ? null : peer;
  const kind = { image: 'photo', audio: 'audio', video: 'video', document: 'document', vcard: 'contact', geo: 'location' }[raw.type] || (raw.type === 'text' ? 'text' : 'other');
  return { ...base, type: 'message', message: {
    id: raw.messageId, direction: raw.isEcho ? 'out' : 'in', ...(raw.isEcho ? { origin: own?.jobId ? 'hd' : 'device', ...(own?.jobId ? { jobId: String(own.jobId) } : {}) } : { sender }),
    kind, text: typeof raw.text === 'string' ? raw.text.slice(0, 20_000) : '', attachments,
    replyToId: typeof raw.quotedMessage?.messageId === 'string' ? raw.quotedMessage.messageId : null, sentAt: raw.dateTime,
  } };
};
const splitText = (text, limit) => {
  const result = [];
  let part = '';
  for (const point of String(text || '')) {
    if (part.length + point.length > limit) { result.push(part); part = ''; }
    part += point;
  }
  if (part) result.push(part);
  return result;
};
const sendParts = (payload, channel) => [
  ...splitText(payload.text, channel.providerTransport === 'wapi' ? 1024 : channel.type === 'whatsapp' ? 10_000 : 4096).map(text => ({ text })),
  ...(payload.attachments || []).map(attachment => ({ attachment })),
];
const mediaUrl = raw => {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['store.wazzup24.com', 'store.wazzup24.ru'].includes(url.hostname) ? url : null;
  } catch { return null; }
};

module.exports = { normalizeAccount, normalizeMessage, channelState, eventKey, splitText, sendParts, mediaUrl };
