/** Shared inbox gate; readAll independently opens the section. */
export const CONVERSATION_READ_ACCESS = {
  conversation: { actions: ["read", "readAll"], connector: /** @type {const} */ ("OR") },
};

/** Server capabilities are authoritative, including after reassignment. */
export const conversationReplyAllowed = (card, selection) => {
  if (!card.access?.reply) return false;
  if (selection.mode === "free") return !!(card.access.freeReply ?? card.access.all);
  if (selection.mode !== "ticket") return false;
  return !!(card.tickets ?? (card.ticket ? [card.ticket] : []))
    .find((ticket) => ticket.id === selection.ticket?.id)?.canReply;
};
