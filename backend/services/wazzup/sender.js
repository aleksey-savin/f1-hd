const { sendParts } = require('./events');
const { ProviderError } = require('./provider');
// One durable intent before every external side effect. A crash with unknown
// acceptance never automatically resends; the operator may explicitly retry.
const createSender = ({ send, attachmentUrl, checkpoint }) => async (job, channel) => {
  const parts = sendParts(job.payload, channel);
  let progress = { nextPart: 0, externalIds: [], inFlightPart: null, ...(job.result || {}) };
  if (progress.inFlightPart !== null && progress.inFlightPart !== undefined) throw new ProviderError('Результат отправки неизвестен — проверьте переписку в Wazzup перед повтором');
  for (let index = progress.nextPart; index < parts.length; index++) {
    const part = parts[index];
    const chatId = progress.chatId || job.payload.chatId;
    const address = chatId ? { chatId } : channel.type === 'whatsapp'
      ? { chatId: job.payload.recipient.phone } : { phone: job.payload.recipient.phone };
    const body = {
      channelId: channel.providerChannelId,
      chatType: job.payload.kind === 'group' ? { whatsapp: 'whatsgroup', telegram: 'telegroup', max: 'maxgroup' }[channel.type] : channel.type,
      ...address, crmMessageId: `${job._id}:${index}`,
      ...(job.payload.replyToExternalId ? { refMessageId: job.payload.replyToExternalId } : {}),
      ...(part.text === undefined ? { contentUri: await attachmentUrl(part.attachment) } : { text: part.text }),
    };
    progress = { ...progress, inFlightPart: index };
    await checkpoint(progress);
    let result;
    try { result = await send(body); }
    catch (error) {
      if (error.retryable) { progress = { ...progress, inFlightPart: null }; await checkpoint(progress); }
      throw error;
    }
    if (typeof result?.messageId !== 'string' || !result.messageId) throw new ProviderError('Результат отправки неизвестен — проверьте переписку в Wazzup перед повтором');
    const resolved = typeof result.chatId === 'string' && result.chatId.length > 0 && result.chatId.length <= 200 ? result.chatId : chatId || (channel.type === 'whatsapp' ? address.chatId : null);
    if (job.payload.recipient && !resolved) throw new ProviderError('Wazzup принял сообщение, но не вернул получателя — проверьте переписку перед повтором');
    progress = { nextPart: index + 1, inFlightPart: null, externalIds: [...progress.externalIds, result.messageId], ...(resolved ? { chatId: resolved } : {}) };
    await checkpoint(progress);
  }
  return { ...progress, externalId: progress.externalIds[0] };
};
module.exports = { createSender };
