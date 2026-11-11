const fail = (message, status = 409) => new (require('@/middleware/errorHandling').AppError)(message, status);
const validateReplyReference = async ({ conversation, channel, replyToId, auth }) => {
  if (!replyToId) return {};
  if (!require('mongoose').isValidObjectId(replyToId)) throw fail('Сообщение не найдено', 404);
  if (channel.provider !== 'wazzup') throw fail('Это подключение не поддерживает ответы с цитатой');
  const source = await require('@/models/message').findById(replyToId).lean();
  if (!source || String(source.conversationId) !== String(conversation._id)) throw fail('Сообщение не найдено', 404);
  if (auth && !require('./access').readsAll(auth)) {
    const scope = auth.messagingScope || await require('./access').loadMessageScope(auth);
    if (!source.ticketId || !scope.ticketIds.some(id => String(id) === String(source.ticketId))) throw fail('Сообщение не найдено', 404);
  }
  if (source.deletedAt || source.direction === 'system') throw fail('Сообщение недоступно для ответа');
  const externalId = source.externalId || source.externalIds?.[0];
  if (!externalId) throw fail('Дождитесь подтверждения доставки сообщения');
  return { replyToId: source._id, replyToExternalId: externalId };
};
module.exports = { validateReplyReference };
