const mongoose = require('mongoose');
const idOf = value => String(value?._id ?? value);
const oid = value => new mongoose.Types.ObjectId(idOf(value));
const readsAll = auth => Boolean(auth?.isAdmin || auth?.can({ conversation: ['readAll'] }));
const canReadInbox = auth => readsAll(auth) || Boolean(auth?.can({ conversation: ['read'] }));
const canStartDiscussion = auth => canReadInbox(auth) && Boolean(auth?.can({ conversation: ['reply', 'start'] }));
const canReplyWithoutTicket = (conversation, auth) => readsAll(auth) || (conversation.kind === 'direct' && canStartDiscussion(auth));
const canReadOwnDiscussion = (message, auth) => canReadInbox(auth) && !message.ticketId && message.attachMode === 'free'
  && Boolean(message.discussionUserId) && idOf(message.discussionUserId) === String(auth.userId);
const canReadMessage = (message, auth) => readsAll(auth) || canReadOwnDiscussion(message, auth)
  || (canReadInbox(auth) && Boolean(message.ticketId) && (auth.messagingScope?.ticketIds || []).some(id => idOf(id) === idOf(message.ticketId)));
const responsible = (ticket, auth) => (ticket?.responsibles || []).some(person => idOf(person) === String(auth.userId));
const canReadTicketMessages = (ticket, auth) => Boolean(ticket && !ticket.deletedAt && canReadInbox(auth) && (
  readsAll(auth) || responsible(ticket, auth) || (ticket.messagingReaderIds || []).some(id => idOf(id) === String(auth.userId))
));
// Scope only: the caller must also check the action (reply or ticket.sendMessage).
const canReplyToTicket = (ticket, auth) => Boolean(ticket && !ticket.deletedAt && !ticket.isClosed && (readsAll(auth) || responsible(ticket, auth)));
const ownTicketFilter = auth => ({ deletedAt: null, $or: [
  { 'responsibles._id': oid(auth.userId) }, { messagingReaderIds: oid(auth.userId) },
] });
const ticketMessageFilter = auth => ({ ticketId: { $in: (auth.messagingScope?.ticketIds || []).map(oid) } });
const discussionFilter = auth => ({ ticketId: null, attachMode: 'free', discussionUserId: oid(auth.userId) });
const messageFilter = auth => readsAll(auth) ? {} : !canReadInbox(auth) ? { _id: { $in: [] } }
  : { $or: [ticketMessageFilter(auth), discussionFilter(auth)] };
const loadMessageScope = async auth => {
  if (readsAll(auth)) return { all: true, ticketIds: [], conversationIds: [] };
  if (!canReadInbox(auth)) return { all: false, ticketIds: [], conversationIds: [] };
  const { Ticket } = require('@/models/ticket');
  const Message = require('@/models/message');
  const ticketIds = (await Ticket.find(ownTicketFilter(auth)).select('_id').lean()).map(ticket => ticket._id);
  const conversationIds = await Message.distinct('conversationId', { ...messageFilter({ ...auth, messagingScope: { ticketIds } }), conversationId: { $ne: null } });
  return { all: false, ticketIds, conversationIds };
};
const scopeAuth = async auth => ({ ...auth, messagingScope: await loadMessageScope(auth) });

// Runs before pagination/search/queue filtering: no foreign preview, timestamp,
// binding or waiting state may escape via a conversation-level summary.
const scopedConversationStages = auth => {
  if (readsAll(auth)) return [];
  const ticketIds = (auth.messagingScope?.ticketIds || []).map(oid);
  return [
    { $match: require('./visibility').visibilityFilter(auth) },
    { $lookup: { from: 'messages', localField: '_id', foreignField: 'conversationId',
      pipeline: [{ $match: { ...messageFilter(auth), deletedAt: null } }, { $sort: { sentAt: -1, seq: -1 } }, { $limit: 1 }], as: '_visibleLast' } },
    { $set: {
      lastMessage: { $cond: [{ $gt: [{ $size: '$_visibleLast' }, 0] }, {
        at: { $arrayElemAt: ['$_visibleLast.sentAt', 0] }, direction: { $arrayElemAt: ['$_visibleLast.direction', 0] },
        origin: { $arrayElemAt: ['$_visibleLast.origin', 0] }, preview: { $arrayElemAt: ['$_visibleLast.text', 0] },
        authorName: { $arrayElemAt: ['$_visibleLast.authorName', 0] },
      }, null] },
      awaitingSince: { $cond: [{ $eq: [{ $arrayElemAt: ['$_visibleLast.direction', 0] }, 'in'] }, { $arrayElemAt: ['$_visibleLast.sentAt', 0] }, null] },
      ticketBindings: { $filter: { input: { $ifNull: ['$ticketBindings', { $cond: [{ $ifNull: ['$binding.ticketId', false] }, ['$binding'], []] }] }, as: 'link', cond: { $in: ['$$link.ticketId', ticketIds] } } },
      decision: null,
      assigneeId: null,
      binding: { $cond: [{ $in: ['$binding.ticketId', ticketIds] }, '$binding', null] },
    } },
    { $unset: '_visibleLast' },
  ];
};
module.exports = { readsAll, canReadInbox, canStartDiscussion, canReplyWithoutTicket, canReadOwnDiscussion, canReadMessage, canReadTicketMessages, canReplyToTicket, ownTicketFilter, ticketMessageFilter, messageFilter, loadMessageScope, scopeAuth, scopedConversationStages };
