const mongoose = require("mongoose");

const { scopeCompanyIds } = require("@/services/ticketScope");

const { readsAll, canReadInbox } = require('./access');
const oid = id => new mongoose.Types.ObjectId(String(id));
const visibilityFilter = auth => readsAll(auth) ? {} : { $or: [
  { _id: { $in: (auth.messagingScope?.conversationIds || []).map(oid) } },
  { 'ticketBindings.ticketId': { $in: (auth.messagingScope?.ticketIds || []).map(oid) } },
  { ticketBindings: { $exists: false }, 'binding.ticketId': { $in: (auth.messagingScope?.ticketIds || []).map(oid) } },
] };

const QUEUES = ["awaiting", "mine", "unbound", "all", "hidden"];

/** Фильтр очереди «Диалогов»; null — такой очереди нет. */
const queueFilter = (queue, auth) => {
  const shown = { hidden: { $ne: true } };
  switch (queue) {
    case "awaiting":
      return { ...shown, awaitingSince: { $ne: null } };
    case "mine":
      if (!readsAll(auth)) return shown;
      return {
        ...shown,
        $or: [
          { assigneeId: oid(auth.userId) },
          { assigneeId: null, companyId: { $in: scopeCompanyIds(auth).map(oid) } },
        ],
      };
    case "unbound":
      return { ...shown, $or: [
        { ticketBindings: { $exists: false }, $or: [{ "binding.ticketId": null }, { "binding.endedAt": { $ne: null } }] },
        { ticketBindings: { $exists: true, $not: { $elemMatch: { ticketId: { $ne: null }, endedAt: null } } } },
      ] };
    case "all":
      return shown;
    case "hidden":
      return { hidden: true };
    default:
      return null;
  }
};

/** Видимость, очередь и доп. условия — через $and: у каждого может быть свой $or. */
const listFilter = (queue, auth, extra = {}) => {
  const queuePart = queueFilter(queue, auth);
  if (!queuePart) return null;
  const parts = [visibilityFilter(auth), queuePart, extra].filter((part) => Object.keys(part).length);
  return { $and: parts };
};

/** Виден ли человеку этот диалог — то же правило в памяти, для карточки. */
const canSeeConversation = (conversation, auth) => {
  if (!canReadInbox(auth)) return false;
  if (readsAll(auth)) return true;
  if ((auth.messagingScope?.conversationIds || []).some(id => String(id) === String(conversation._id))) return true;
  const ids = new Set((auth.messagingScope?.ticketIds || []).map(String));
  const links = Array.isArray(conversation.ticketBindings) ? conversation.ticketBindings : [conversation.binding || {}];
  return links.some(link => ids.has(String(link.ticketId)));
};

module.exports = { QUEUES, visibilityFilter, queueFilter, listFilter, canSeeConversation };
