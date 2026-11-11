const { linkedOpenTickets, replyContext, CONTEXT_MS } = require('./multi-ticket');
const fail = (message, status = 409) => new (require('@/middleware/errorHandling').AppError)(message, status);
const accessibleTickets = async (conversation, auth) => {
  const { canReplyToTicket } = require('./access');
  return (await linkedOpenTickets(conversation)).filter((ticket) => canReplyToTicket(ticket, auth));
};
const freeGroupContext = () => ({ ticketId: null, withoutTicket: true, expiresAt: null, required: false });
const loadReplyContext = async ({ conversation, auth }) => {
  if (conversation.kind !== "direct") return freeGroupContext();
  const [tickets, read] = await Promise.all([
    accessibleTickets(conversation, auth),
    require('@/models/conversationRead').findOne({ conversationId: conversation._id, userId: auth.userId }).lean(),
  ]);
  return replyContext({ tickets, saved: read?.replyContext });
};
const chooseReplyContext = async ({ conversation, auth, ticketNum }) => {
  if (conversation.kind !== "direct") {
    if (ticketNum !== null) throw fail("Групповой чат к заявке не привязывается");
    if (!require("./access").readsAll(auth)) throw fail("Недостаточно прав для ответа без заявки", 403);
    return freeGroupContext();
  }
  if (ticketNum === null && !require("./access").readsAll(auth)) throw fail("Недостаточно прав для ответа без заявки", 403);
  if (ticketNum !== null && (!Number.isInteger(Number(ticketNum)) || Number(ticketNum) <= 0)) throw fail('Укажите номер заявки', 400);
  const tickets = await accessibleTickets(conversation, auth);
  const ticket = ticketNum === null ? null : tickets.find((item) => item.num === Number(ticketNum));
  if (ticketNum !== null && !ticket) throw fail('Заявка недоступна, закрыта или не связана с диалогом');
  const prefs = await require('@/models/preferences').findOne({}).select('messaging.replyContextTimeoutMinutes').lean();
  const timeout = prefs?.messaging?.replyContextTimeoutMinutes ? prefs.messaging.replyContextTimeoutMinutes * 60_000 : CONTEXT_MS;
  const context = { updatedAt: new Date(), ticketId: ticket?._id || null, withoutTicket: ticketNum === null, expiresAt: new Date(Date.now() + timeout) };
  await require('@/models/conversationRead').updateOne(
    { conversationId: conversation._id, userId: auth.userId }, { $set: { replyContext: context } }, { upsert: true },
  );
  return { ...context, ticketId: ticket ? String(ticket._id) : null, required: false };
};
const resolveReplyTicket = async ({ conversation, auth, ticketNum, withoutTicket = false }) => {
  if (ticketNum !== undefined && withoutTicket) throw fail('Выберите заявку или «Без заявки»', 400);
  const explicit = ticketNum !== undefined || withoutTicket;
  const context = explicit
    ? await chooseReplyContext({ conversation, auth, ticketNum: withoutTicket ? null : ticketNum })
    : await loadReplyContext({ conversation, auth });
  if (context.required) throw fail('Выберите заявку или «Без заявки» перед ответом');
  if (!context.ticketId) {
    if (!require("./access").readsAll(auth)) throw fail("Недостаточно прав для ответа без заявки", 403);
    if (!explicit && context.withoutTicket) await chooseReplyContext({ conversation, auth, ticketNum: null });
    return null;
  }
  // Revalidate after context persistence: closing or removing a link must not silently retarget a send.
  const current = await require('@/models/conversation').findById(conversation._id).lean();
  const tickets = await accessibleTickets(current || conversation, auth);
  const ticket = tickets.find((item) => String(item._id) === context.ticketId);
  if (!ticket) throw fail('Заявка недоступна, закрыта или не связана с диалогом');
  if (!explicit) await chooseReplyContext({ conversation: current || conversation, auth, ticketNum: ticket.num });
  return ticket;
};
module.exports = { loadReplyContext, chooseReplyContext, resolveReplyTicket };
