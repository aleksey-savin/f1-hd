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
    const body = {
      channelId: channel.providerChannelId,
      chatType: job.payload.kind === 'group' ? { whatsapp: 'whatsgroup', telegram: 'telegroup', max: 'maxgroup' }[channel.type] : channel.type,
      chatId: job.payload.chatId, crmMessageId: `${job._id}:${index}`,
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
    progress = { nextPart: index + 1, inFlightPart: null, externalIds: [...progress.externalIds, result.messageId] };
    await checkpoint(progress);
  }
  return { ...progress, externalId: progress.externalIds[0] };
};
module.exports = { createSender };
