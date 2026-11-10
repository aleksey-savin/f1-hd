const { normalizeMessage, channelState } = require('./events');
const { validateEvent } = require('../messaging/events');
const aggregateStatus = (ids, statuses) => {
  const values = ids.map(id => statuses[id] || 'sent');
  if (values.includes('failed')) return 'failed';
  if (values.length && values.every(value => value === 'read')) return 'read';
  if (values.length && values.every(value => ['read', 'delivered'].includes(value))) return 'delivered';
  return 'sent';
};
/** true = processed/ignored permanently, false = correlation not yet available. */
const createProcessor = deps => {
  const process = async item => {
  const raw = item.payload;
  if (item.kind === 'statuses') {
    if (typeof raw.messageId !== 'string' || !['sent', 'delivered', 'read', 'error'].includes(raw.status)) return true;
    const own = await deps.findMessage(raw.messageId);
    if (!own) return false;
    const status = await deps.status(own, { ...raw, status: raw.status === 'error' ? 'failed' : raw.status });
    const event = { type: 'message.status', channelId: String(own.channelId), status, ...(own.jobId ? { jobId: String(own.jobId) } : { chat: { id: own.externalChatId }, messageIds: [raw.messageId] }), error: raw.status === 'error' ? 'Wazzup не доставил сообщение — проверьте аккаунт и переписку в Wazzup' : '' };
    const checked = validateEvent(event);
    if (checked.ok) await deps.ingest(checked.event);
    return true;
  }
  if (typeof raw.channelId !== 'string') return true;
  const channel = await deps.findChannel(raw.channelId);
  if (!channel) return true;
  if (item.kind === 'channelsUpdates') {
    const state = channelState(raw.state);
    await deps.ingest({ type: 'channel.state', channelId: String(channel._id), ...state });
    await deps.updateAccount(raw.channelId, raw.state, state.reason);
    return true;
  }
  const own = typeof raw.messageId === 'string' ? await deps.findMessage(raw.messageId, channel._id) : null;
  if (raw.isEcho === true && !own && await deps.hasSending(channel._id, raw.chatId)) return false;
  let event = normalizeMessage(raw, channel, { own });
  if (!event) return true;
  // A logical HD reply may have several provider ids. Deleting any part marks
  // the logical reply; the common ingest contract keys deletion by primary id.
  if (event.type === 'message.deleted' && own?.externalId) event.messageIds = [own.externalId];
  if (event.type === 'message' && !own?.jobId && raw.contentUri) {
    const attachments = own?.attachments || [await deps.media(raw, channel)];
    event = normalizeMessage(raw, channel, { own, attachments });
  }
  const checked = validateEvent(event);
  if (!checked.ok) return true;
  const result = await deps.ingest(checked.event);
  if (result?.ok === false && result.retryable !== false) throw new Error('Не удалось обработать событие Wazzup');
  if (result?.ok !== false && !result?.ignored && event.type === 'message' && event.message.direction === 'in') await deps.onMessage?.(event.message.sentAt);
  if (result?.ok !== false && raw.isEcho === true && ['sent', 'delivered', 'read', 'error'].includes(raw.status)) {
    return process({ kind: 'statuses', payload: { messageId: raw.messageId, status: raw.status, error: raw.error } });
  }
  return true;
  };
  return process;
};
module.exports = { createProcessor, aggregateStatus };
