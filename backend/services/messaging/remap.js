const { withMessageLease } = require('./message-lease');
const { mirrorToTicketLocked } = require('./mirror');
const { userTalksHere } = require('./conversationStore');

/** Durable intent survives every boundary between message, comment and ticket writes. */
const reconcileMapping = async ({ message, conversation, ticket, by, assertLease = async () => {} }) => {
  const Message = require('@/models/message');
  const Comment = require('@/models/comment');
  const { Ticket } = require('@/models/ticket');
  const intent = message.mappingIntent;
  const existing = await Comment.findOne(message.commentId ? { _id: message.commentId } : { 'channel.messageId': message._id }).lean();
  const previousIds = [...new Set([intent?.previousTicketId, existing?.ticketId].filter(Boolean).map(String))];
  if (existing) {
    for (const id of previousIds) {
      await assertLease();
      if (String(ticket?._id) !== id) await Ticket.updateOne({ _id: id }, { $pull: { comments: existing._id } });
    }
    await assertLease();
    await Comment.updateOne({ _id: existing._id }, { $set: { ticketId: ticket?._id || null, 'notifications.pending': false } });
    await assertLease();
    if (ticket) await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { comments: existing._id } });
    await Message.updateOne({ _id: message._id }, { $set: { commentId: existing._id } });
  } else if (ticket) {
    const [identity, channel, prefs] = await Promise.all([
      message.identityId ? require('@/models/channelIdentity').findById(message.identityId).lean() : null,
      require('@/models/channel').findById(conversation.channelId).lean(),
      require('@/models/preferences').findOne({}).select('defaultApplicant').lean(),
    ]);
    await mirrorToTicketLocked({ message, ticket, conversation, identity, channel, prefs,
      skipApplicant: await userTalksHere(conversation, ticket.applicantId), assertLease });
  }
  if (ticket && conversation.kind === "direct") {
    const live = await Ticket.findById(ticket._id).lean();
    if (live && !live.isClosed && !live.deletedAt) {
      await assertLease();
      await require("./bindings").bindConversation({ conversation, ticket: live, by, attachPending: false });
    }
  }
  await assertLease();
  await Message.updateOne({ _id: message._id }, { $unset: { mappingIntent: 1 } });
};
const remapMessages = async ({ conversation, messages, ticket, auth, by }) => {
  const Message = require('@/models/message');
  let count = 0;
  for (const snapshot of messages) await withMessageLease(snapshot._id, async (message, lease) => {
    if (auth && message.ticketId) {
      const source = await require("@/models/ticket").Ticket.findById(message.ticketId).lean();
      if (source && !require("@/services/ticketAccess").canAccessTicket(source, auth)) {
        throw new (require("@/middleware/errorHandling").AppError)("Заявка не найдена", 404);
      }
    }
    if (ticket) {
      const live = await require("@/models/ticket").Ticket.findById(ticket._id).lean();
      if (live && auth && !require("@/services/ticketAccess").canAccessTicket(live, auth)) throw new (require("@/middleware/errorHandling").AppError)("Заявка не найдена", 404);
      if (!live || live.deletedAt) throw new (require("@/middleware/errorHandling").AppError)("Заявка удалена", 409);
    }
    if (message.mappingIntent) {
      const pendingTicket = message.ticketId ? await require('@/models/ticket').Ticket.findById(message.ticketId).lean() : null;
      await reconcileMapping({ message, conversation, ticket: pendingTicket, by, assertLease: lease.assertOwned });
      message.mappingIntent = null;
    }
    const same = String(message.ticketId || '') === String(ticket?._id || '') && (ticket || message.attachMode === 'free');
    if (same && (message.commentId || !ticket)) return;
    const mappingIntent = { previousTicketId: message.ticketId, ticketId: ticket?._id || null, ticketNum: ticket?.num || null };
    const changes = { previousTicketIds: [...new Set([...(message.previousTicketIds || []), message.ticketId].filter(Boolean).map(String))], ticketId: ticket?._id || null, ticketNum: ticket?.num || null, attachMode: ticket ? 'manual' : 'free', suggestTicketId: null, mappingIntent, 'effects.attach': true };
    await lease.assertOwned();
    await Message.updateOne({ _id: message._id }, { $set: changes });
    Object.assign(message, changes);
    await reconcileMapping({ message, conversation, ticket, by, assertLease: lease.assertOwned });
    count++;
  });
  if (!count && ticket && conversation.kind === "direct") {
    const live = await require("@/models/ticket").Ticket.findById(ticket._id).lean();
    if (!live || live.isClosed || live.deletedAt) return count;
    await require("./bindings").bindConversation({ conversation, ticket: live, by, attachPending: false });
  }
  return count;
};
const repairMappings = async () => {
  const Message = require('@/models/message');
  const rows = await Message.find({ mappingIntent: { $exists: true } }).limit(50).lean();
  for (const row of rows) {
    try {
      await withMessageLease(row._id, async (message, lease) => {
        if (!message.mappingIntent) return;
        const conversation = await require('@/models/conversation').findById(message.conversationId).lean();
        const ticket = message.ticketId ? await require('@/models/ticket').Ticket.findById(message.ticketId).lean() : null;
        if (conversation) await reconcileMapping({ message, conversation, ticket, assertLease: lease.assertOwned });
      });
    } catch (error) {
      require('@/utils/logger').log('warn', 'Не восстановлено распределение сообщения', { module: 'messaging', messageId: String(row._id), error: error.message });
    }
  }
};
module.exports = { remapMessages, repairMappings };
