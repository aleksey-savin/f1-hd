const { canReadTicketMessages } = require('./access');
const { visibilityFilter } = require('./visibility');
const { activeBindings } = require('./multi-ticket');
const { identityName } = require('./rules');
const { userName } = require('./present');

/** Ticket navigation includes mapped history as well as active chat bindings. */
const ticketDialogs = async ({ tickets, currentId, auth }) => {
  const visibleTickets = tickets.filter(ticket => canReadTicketMessages(ticket, auth));
  const result = new Map(visibleTickets.map(ticket => [String(ticket._id), []]));
  if (!visibleTickets.length) return result;
  const ids = visibleTickets.map(ticket => ticket._id);
  const pairs = await require('@/models/message').aggregate([
    { $match: { ticketId: { $in: ids }, deletedAt: null, conversationId: { $ne: null } } },
    { $group: { _id: { ticketId: '$ticketId', conversationId: '$conversationId' } } },
  ]);
  const conversations = await require('@/models/conversation').find({ $and: [
    { _id: { $ne: currentId }, hidden: { $ne: true } },
    visibilityFilter(auth),
    { $or: [
      { _id: { $in: pairs.map(pair => pair._id.conversationId) } },
      { ticketBindings: { $elemMatch: { ticketId: { $in: ids }, endedAt: null } } },
      { ticketBindings: { $exists: false }, 'binding.ticketId': { $in: ids }, 'binding.endedAt': null },
    ] },
  ] }).select('_id network kind title counterpartIdentityId ticketBindings binding').lean();
  const identities = await require('@/models/channelIdentity').find({ _id: { $in: conversations.map(row => row.counterpartIdentityId).filter(Boolean) } }).lean();
  const users = await require('@/models/user').find({ _id: { $in: identities.map(row => row.userId).filter(Boolean) } }).select('firstName lastName').lean();
  const people = new Map(users.map(row => [String(row._id), row]));
  const counterparts = new Map(identities.map(row => [String(row._id), row]));
  for (const row of conversations) {
    const identity = counterparts.get(String(row.counterpartIdentityId));
    const title = row.kind === 'direct'
      ? userName(people.get(String(identity?.userId))) || identityName(identity) || row.title
      : row.title;
    const relatedIds = new Set([
      ...pairs.filter(pair => String(pair._id.conversationId) === String(row._id)).map(pair => String(pair._id.ticketId)),
      ...activeBindings(row).map(link => String(link.ticketId)),
    ]);
    for (const id of relatedIds) result.get(id)?.push({ id: String(row._id), network: row.network, title: title || '' });
  }
  for (const rows of result.values()) rows.sort((a, b) => a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id));
  return result;
};
module.exports = { ticketDialogs };
