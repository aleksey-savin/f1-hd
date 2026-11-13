/**
 * Context selection and filtering shared by the desktop thread and phone sheet.
 * The server is authoritative; a saved selection cannot revive an expired or
 * closed ticket. No employee context is stored in a shared browser key.
 * @typedef {import('../types/conversation').ConversationTicket} ConversationTicket
 * @typedef {import('../types/conversation').ConversationCard} ConversationCard
 * @typedef {import('../types/conversation').ConversationReplySelection} ReplySelection
 */

/** @param {ConversationCard} card @returns {ConversationTicket[]} */
export const conversationTickets = (card) =>
  card.tickets ?? (card.ticket ? [card.ticket] : []);

/** @param {import('../types/conversation').MessageRow[]} messages @param {string[]} ids */
export const canCreateTicketFromMessages = (messages, ids) =>
  ids.length > 0 &&
  ids.every((id) => {
    const message = messages.find((item) => item.id === id);
    return Boolean(
      message &&
        !message.ticket &&
        !message.deletedAt &&
        message.direction !== "system",
    );
  });

/** @param {ConversationCard} card @param {Date} [now] @returns {ReplySelection} */
export const replySelection = (card, now = new Date()) => {
  if (card.conversation?.kind === "group") {
    return { mode: "free", ticket: null, expiresAt: null };
  }
  const tickets = conversationTickets(card);
  const context = card.replyContext;
  const expiresAt = context?.expiresAt ?? null;
  const updatedAt = context?.updatedAt ?? null;
  const choose = {
    mode: /** @type {const} */ ("choose"),
    ticket: null,
    expiresAt,
    updatedAt,
  };
  if (
    context?.required ||
    (expiresAt && Date.parse(expiresAt) <= now.getTime())
  )
    return choose;
  if (context?.withoutTicket)
    return { mode: "free", ticket: null, expiresAt, updatedAt };
  if (context?.ticketId) {
    const ticket = tickets.find((item) => item.id === context.ticketId);
    return ticket ? { mode: "ticket", ticket, expiresAt, updatedAt } : choose;
  }
  if (tickets.length === 1)
    return { mode: "ticket", ticket: tickets[0], expiresAt: null };
  return tickets.length
    ? choose
    : { mode: "free", ticket: null, expiresAt: null };
};

/**
 * @param {import('../types/conversation').MessageRow[]} messages
 * @param {ReplySelection} selection
 * @param {string} [kind]
 * @param {boolean} [showAll] Viewing history never changes the reply context.
 */
export const filterContextMessages = (
  messages,
  selection,
  kind = "direct",
  showAll = false,
) =>
  showAll || kind === "group" || selection.mode === "choose"
    ? messages
    : messages.filter(
        (message) =>
          message.direction === "system" ||
          !message.ticket ||
          (selection.mode === "ticket" &&
            message.ticket.id === selection.ticket?.id),
      );

/** @param {import('../types/conversation').MessageRow} message @param {ConversationTicket[]} tickets */
export const messageContextLabel = (message, tickets) => {
  if (!message.ticket)
    return message.attachMode === "free" ? "Без заявки" : "Нужно разобрать";
  return (
    tickets.find((ticket) => ticket.id === message.ticket.id)?.title ||
    message.ticket.title ||
    `${message.ticket.num}`
  );
};

/** @param {ReplySelection} selection @returns {{ticketNum:number,withoutTicket?:never}|{withoutTicket:true,ticketNum?:never}|null} */
export const replyTarget = (selection) =>
  selection.mode === "ticket" && selection.ticket
    ? { ticketNum: selection.ticket.num }
    : selection.mode === "free"
      ? { withoutTicket: true }
      : null;

/**
 * An already running route loader can return the context from before a choice.
 * Keep the confirmed selection until the same or newer server revision arrives.
 * @param {ReplySelection|null} local
 * @param {ConversationCard} card
 * @param {Date} [now]
 * @returns {ReplySelection}
 */
export const reconcileReplySelection = (local, card, now = new Date()) => {
  const server = replySelection(card, now);
  if (!local || card.conversation?.kind === "group") return server;
  // Browsing a read-only ticket is local: no reply context is written to the
  // server. Refresh its details without restoring the previous reply target.
  const reader = card.access?.reply === false;
  if (local.mode === "ticket" && (reader || local.ticket?.canReply === false)) {
    const ticket = conversationTickets(card).find(
      (item) => item.id === local.ticket.id,
    );
    return ticket && (reader || ticket.canReply === false)
      ? { ...local, ticket }
      : server;
  }
  if (reader && local.mode === "free") return card.access.all ? local : server;
  if (local.updatedAt) {
    return server.updatedAt &&
      Date.parse(server.updatedAt) >= Date.parse(local.updatedAt)
      ? server
      : local;
  }
  const same =
    local.mode === server.mode &&
    local.ticket?.id === server.ticket?.id &&
    local.expiresAt === server.expiresAt;
  return same ||
    !local.expiresAt ||
    (server.expiresAt &&
      Date.parse(server.expiresAt) >= Date.parse(local.expiresAt))
    ? server
    : local;
};
