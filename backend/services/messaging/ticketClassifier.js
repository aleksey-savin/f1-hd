const Preferences = require("../../models/preferences");
const aiService = require("../aiService");
const { htmlToPlainText } = require("../../helpers/htmlToPlainText");
const buildPrompt = require("../../prompts/messagingTicket");

const PROVIDER_TIMEOUT_MS = 8_000;
const MAX_TICKETS = 10;
const id = (value) => String(value?._id ?? value ?? "");
const text = (value, limit) => htmlToPlainText(value).slice(0, limit);
const grounded = (quote, source) =>
  typeof quote === "string" &&
  quote.trim().length >= 8 &&
  source.includes(quote.trim());

// The caller supplies already scoped tickets; no broad ticket lookup or writes
// belong here. The ingest CAS remains responsible for preserving manual choices.
const classifyIncomingTicket = async ({
  conversation,
  message,
  linkedTickets,
  recentMessages = [],
}) => {
  let timer;
  try {
    if (
      conversation.kind !== "direct" ||
      !conversation.companyId ||
      message.direction !== "in" ||
      message.origin !== "client" ||
      message.imported ||
      message.deletedAt ||
      message.ticketId ||
      message.attachMode ||
      !message.text?.trim()
    )
      return null;
    if (
      message.conversationId &&
      id(message.conversationId) !== id(conversation._id)
    )
      return null;
    const preferences = await Preferences.findOne({});
    if (
      preferences?.messaging?.aiTicketRouting !== true ||
      preferences.ai?.isActive !== true
    )
      return null;

    const active = (conversation.ticketBindings || []).filter(
      (binding) => !binding.endedAt,
    );
    if (
      !active.length &&
      conversation.binding?.ticketId &&
      !conversation.binding.endedAt
    )
      active.push(conversation.binding);
    const linkedIds = new Set(active.map((binding) => id(binding.ticketId)));
    const tickets = linkedTickets
      .filter(
        (ticket) =>
          linkedIds.has(id(ticket._id)) &&
          !ticket.isClosed &&
          !ticket.deletedAt &&
          !ticket.isArchived &&
          id(ticket.company?._id) === id(conversation.companyId),
      )
      .map((ticket) => ({
        id: id(ticket._id),
        title: text(ticket.title, 200),
        description: text(ticket.description, 1_600),
      }));
    if (tickets.length < 2 || tickets.length > MAX_TICKETS) return null;
    const eligibleIds = new Set(tickets.map((ticket) => ticket.id));
    const timeoutMinutes =
      preferences.messaging.replyContextTimeoutMinutes ?? 30;
    const at = new Date(message.sentAt).getTime();
    const history = recentMessages
      .filter(
        (item) =>
          id(item.conversationId) === id(conversation._id) &&
          eligibleIds.has(id(item.ticketId)) &&
          !item.deletedAt &&
          !item.imported &&
          ["in", "out"].includes(item.direction) &&
          new Date(item.sentAt).getTime() <= at &&
          at - new Date(item.sentAt).getTime() <= timeoutMinutes * 60_000,
      )
      .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt))
      .slice(-8)
      .map((item) => ({
        ticketId: id(item.ticketId),
        direction: item.direction,
        text: text(item.text, 600),
      }));
    const input = {
      message: { text: text(message.text, 2_000) },
      tickets,
      recentMessages: history,
    };
    const result = await Promise.race([
      aiService.generateJson({ ...buildPrompt(input), maxTokens: 400 }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), PROVIDER_TIMEOUT_MS);
      }),
    ]);
    const output = result?.data;
    if (
      !output ||
      Array.isArray(output) ||
      typeof output.ticketId !== "string" ||
      !eligibleIds.has(output.ticketId) ||
      output.ambiguous !== false ||
      typeof output.confidence !== "number" ||
      !Number.isFinite(output.confidence) ||
      output.confidence < 0.9 ||
      output.confidence > 1
    )
      return null;
    const ticket = tickets.find(
      (candidate) => candidate.id === output.ticketId,
    );
    if (
      !grounded(output.messageQuote, input.message.text) ||
      ![ticket.title, ticket.description].some((source) =>
        grounded(output.ticketQuote, source),
      )
    )
      return null;
    if (
      tickets.some(
        (candidate) =>
          candidate.id !== ticket.id &&
          [candidate.title, candidate.description].some((source) =>
            grounded(output.ticketQuote, source),
          ),
      )
    )
      return null;
    return {
      ticketId: ticket.id,
      attachMode: "ai",
      confidence: output.confidence,
    };
  } catch {
    // Optional assistance must never turn an accepted inbound event into a
    // failed job or trigger a retry merely because a provider is unavailable.
    return null;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { classifyIncomingTicket };
