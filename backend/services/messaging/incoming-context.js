const { CONTEXT_MS } = require('./multi-ticket');

/** Only actual message evidence carries a conversation topic between exchanges.
 * A staff member selecting an unsent composer context is never such evidence. */
const incomingRoutingContext = async ({ conversation, message }) => {
  const Message = require('@/models/message');
  const replyToMessage = message.replyToId ? await Message.findOne({ _id: message.replyToId, conversationId: conversation._id })
    .select('_id ticketId attachMode discussionUserId direction status imported deletedAt externalId externalIds').lean() : null;
  if (conversation.kind !== 'direct' || message.imported || message.direction !== 'in' || message.origin !== 'client') {
    return { replyToMessage, recentExchange: null, freeWindowMs: CONTEXT_MS };
  }
  const prefs = await require('@/models/preferences').findOne({}).select('messaging.replyContextTimeoutMinutes').lean();
  const freeWindowMs = prefs?.messaging?.replyContextTimeoutMinutes ? prefs.messaging.replyContextTimeoutMinutes * 60_000 : CONTEXT_MS;
  const recentExchange = await Message.findOne({
    conversationId: conversation._id,
    _id: { $ne: message._id }, imported: { $ne: true }, deletedAt: null,
    $and: [
      // An accepted device/legacy send ends the previous private topic even
      // when it has no mapping; unresolved inbound arrivals are not evidence.
      { $or: [{ ticketId: { $ne: null } }, { attachMode: 'free' }, { direction: 'out' }] },
      { $or: [{ direction: 'in' }, { direction: 'out', status: { $in: ['sent', 'delivered', 'read'] } }] },
      { $or: [{ sentAt: { $lt: message.sentAt } }, { sentAt: message.sentAt, seq: { $lt: message.seq } }] },
    ],
    sentAt: { $gte: new Date(new Date(message.sentAt).getTime() - freeWindowMs) },
  }).sort({ sentAt: -1, seq: -1 }).select('_id ticketId attachMode discussionUserId sentAt direction status').lean();
  return { replyToMessage, recentExchange, freeWindowMs };
};
const findQuotedSource = ({ channelId, externalChatId, externalId }) => require("@/models/message").findOne({
  channelId, externalChatId, $or: [{ externalId }, { externalIds: externalId }],
}).select("_id").lean();
const persistFreeMapping = (messageId, discussionUserId) => require('@/models/message').updateOne(
  { _id: messageId, ticketId: null, attachMode: null, mappingIntent: { $exists: false } },
  { $set: { ticketId: null, ticketNum: null, attachMode: 'free', suggestTicketId: null, discussionUserId: discussionUserId || null } },
);
module.exports = { incomingRoutingContext, persistFreeMapping, findQuotedSource };
