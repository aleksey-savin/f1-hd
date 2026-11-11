/** Active links use an explicit array when present; old documents retain binding semantics. */
const bindingsOf = (conversation) => Array.isArray(conversation.ticketBindings)
  ? conversation.ticketBindings : conversation.binding?.ticketId ? [conversation.binding] : [];
const activeBindings = (conversation) => bindingsOf(conversation).filter((binding) => binding.ticketId && !binding.endedAt);
const CONTEXT_MS = 30 * 60 * 1000;
const replyContext = ({ tickets, saved, now = new Date() }) => {
  const empty = { ticketId: null, withoutTicket: false, expiresAt: null, required: false, ...(saved?.updatedAt ? { updatedAt: saved.updatedAt } : {}) };
  if (saved?.expiresAt && new Date(saved.expiresAt) > now) {
    if (saved.withoutTicket) return { ...empty, withoutTicket: true, expiresAt: saved.expiresAt };
    if (tickets.some((ticket) => String(ticket._id) === String(saved.ticketId))) {
      return { ...empty, ticketId: String(saved.ticketId), expiresAt: saved.expiresAt };
    }
    return { ...empty, required: true };
  }
  if (saved?.expiresAt) return { ...empty, expiresAt: saved.expiresAt, required: true };
  if (tickets.length === 1) return { ...empty, ticketId: String(tickets[0]._id) };
  return { ...empty, required: tickets.length > 1 };
};
const linkedOpenTickets = async (conversation) => {
  if (conversation.kind !== 'direct') return [];
  const { Ticket } = require('@/models/ticket');
  const ids = activeBindings(conversation).map((binding) => binding.ticketId);
  if (!ids.length) return [];
  if (!Array.isArray(conversation.ticketBindings) && ids.length === 1) {
    const ticket = await Ticket.findById(ids[0]).select('_id num title description state deadline responsibles createdBy applicantId applicant company isClosed deletedAt').lean();
    return ticket && !ticket.isClosed && !ticket.deletedAt ? [ticket] : [];
  }
  return Ticket.find({ _id: { $in: ids }, isClosed: { $ne: true }, deletedAt: null })
    .select('_id num title description state deadline responsibles createdBy applicantId applicant company isClosed').lean();
};
module.exports = { bindingsOf, activeBindings, replyContext, linkedOpenTickets, CONTEXT_MS };
