const { createHash } = require("node:crypto");
const { escapeHtml } = require("../telegramMessage");
const { isDeniedAccount } = require("../accountDenial");
const { ticketInScope } = require("../ticketScope");
const { canReadInbox, readsAll, canReadTicketMessages } = require("./access");
const { previewOf, NETWORK_LABEL } = require("./rules");

const STAGES = [
  { name: "personal", minutes: 2, field: "waitTelegramNotifiedAt" },
  { name: "group", minutes: 10, field: "waitTelegramGroupNotifiedAt" },
];
const idOf = (value) => String(value?._id ?? value);
const waitingFilter = (conversation) => ({ _id: conversation._id, awaitingSince: conversation.awaitingSince, hidden: { $ne: true } });
const messageFilter = (conversation) => ({
  conversationId: conversation._id, direction: "in", origin: "client",
  imported: { $ne: true }, deletedAt: null, sentAt: { $gte: conversation.awaitingSince },
});

// A retry after enqueue but before the conversation checkpoint finds the same
// outbox document, even across worker restarts or competing cron runs.
const noticeId = (conversation, stage, chatId) => createHash("sha256")
  .update(`conversation-wait:${conversation._id}:${new Date(conversation.awaitingSince).toISOString()}:${stage}:${chatId}`)
  .digest("hex").slice(0, 24);

const createWaitingNotifier = ({ Conversation, Message, Ticket, User, Preferences, Notification, authFor, fallbackRecipients, baseUrl }) => {
  const usersFor = (ids) => User.find({ _id: { $in: [...new Set(ids.map(idOf))] } });
  const linkFor = async (user, conversation, tickets) => {
    if (!user || user.isEndUser !== false || isDeniedAccount(user)) return null;
    const auth = await authFor(user);
    const fullConversation = readsAll(auth);
    const inbox = canReadInbox(auth);
    const accessibleTickets = tickets.filter(item => inbox ? canReadTicketMessages(item, auth) : ticketInScope(item, auth));
    if (fullConversation || (inbox && accessibleTickets.length)) {
      return { user, tickets: accessibleTickets, fullConversation, link: `/conversations/${conversation._id}` };
    }
    return accessibleTickets.length ? { user, tickets: accessibleTickets, fullConversation: false, link: null } : null;
  };
  const choose = async (users, conversation, tickets) => {
    const chosen = [];
    for (const user of users) {
      // An assignee without a usable Telegram destination must not prevent
      // subscribed ticket responsibles from receiving the personal reminder.
      if (!user.telegramBot?.isActive || !user.telegramBot.chatId || !user.notify?.byTelegram?.ticketNewComment) continue;
      const recipient = await linkFor(user, conversation, tickets);
      if (recipient) chosen.push(recipient);
    }
    return chosen;
  };
  const personalRecipients = async (conversation, tickets) => {
    if (conversation.assigneeId) {
      const assigned = await choose(await usersFor([conversation.assigneeId]), conversation, tickets);
      if (assigned.length) return assigned;
    }
    const ids = tickets.flatMap((ticket) => (ticket.responsibles || []).map(idOf));
    if (ids.length) {
      const responsible = await choose(await usersFor(ids), conversation, tickets);
      if (responsible.length) return responsible;
    }
    const fallback = await fallbackRecipients({ ...conversation, assigneeId: null });
    return choose(await usersFor(fallback.map(idOf)), conversation, tickets);
  };
  const enqueue = async (conversation, message, stage, destination) => {
    const { to, link, ticket } = destination;
    const showConversation = stage.name === "group" || destination.fullConversation;
    const name = showConversation ? (conversation.kind === "group" ? conversation.title : conversation.lastMessage?.authorName || conversation.title) : "";
    const context = [NETWORK_LABEL[conversation.network], name].filter(Boolean).join(" · ");
    const text = [
      `<b>Клиент ждёт ответа ${stage.minutes} мин.</b>`,
      escapeHtml(context),
      ticket ? `Заявка #${ticket.num} · ${escapeHtml(ticket.title)}` : "",
      escapeHtml(previewOf(message)),
    ].filter(Boolean).join("\n");
    const doc = {
      instrument: "telegram", to, title: "Клиент ждёт ответа", text,
      ...(ticket ? { ticketId: ticket._id } : {}),
      conversationWait: { conversationId: conversation._id, awaitingSince: conversation.awaitingSince },
      ...(baseUrl ? { replyMarkup: { inline_keyboard: [[{ text: ticket && link.startsWith("/tickets/") ? "Открыть заявку" : "Открыть диалог", url: `${baseUrl.replace(/\/$/, "")}${link}` }]] } } : {}),
    };
    try {
      await Notification.updateOne({ _id: noticeId(conversation, stage.name, to.chatId) }, { $setOnInsert: doc }, { upsert: true });
    } catch (error) {
      // Concurrent inserts of the exact same deterministic _id are the same
      // event; every other persistence error must retry before checkpointing.
      if (error?.code !== 11000) throw error;
    }
  };
  const runStage = async (conversation, stage, prefs) => {
    const filter = messageFilter(conversation);
    const message = await Message.findOne(filter).sort({ sentAt: -1, seq: -1 }).lean();
    if (message) {
      const ticketIds = await Message.distinct("ticketId", { ...filter, ticketId: { $ne: null } });
      const tickets = ticketIds.length ? await Ticket.find({ _id: { $in: ticketIds }, isClosed: { $ne: true }, deletedAt: null }).lean() : [];
      const destinations = [];
      const telegram = prefs.notify.byTelegram;
      if (stage.name === "group") {
        const ticket = tickets.find((item) => idOf(item) === idOf(message.ticketId));
        if (telegram.sendToGroup && telegram.chatId) destinations.push({
          to: { chatId: telegram.chatId, globalChat: true, ...(telegram.messageThreadId ? { messageThreadId: telegram.messageThreadId } : {}) },
          ticket, link: ticket ? `/tickets/${ticket.num}` : `/conversations/${conversation._id}`,
        });
      } else if (prefs.notify.personal?.ticketNewComment) {
        for (const recipient of await personalRecipients(conversation, tickets)) {
          const { user } = recipient;
          // A conversation can contain several tickets. Ticket-only access
          // permits a preview from those tickets, never the latest foreign
          // message or the conversation-wide last sender's name.
          const visibleMessage = recipient.fullConversation ? message : await Message.findOne({
            ...filter, ticketId: { $in: recipient.tickets.map((ticket) => ticket._id) },
          }).sort({ sentAt: -1, seq: -1 }).lean();
          if (!visibleMessage) continue;
          const ticket = recipient.tickets.find((item) => idOf(item) === idOf(visibleMessage.ticketId));
          destinations.push({
            ticket, message: visibleMessage, fullConversation: recipient.fullConversation, link: recipient.link || `/tickets/${ticket.num}`,
            to: { chatId: user.telegramBot.chatId, responsible: [user.lastName, user.firstName].filter(Boolean).join(" ") },
          });
        }
      }
      for (const destination of destinations) {
        if (!await Conversation.exists(waitingFilter(conversation))) return;
        await enqueue(conversation, destination.message || message, stage, destination);
      }
    }
    await Conversation.updateOne(waitingFilter(conversation), { $set: { [stage.field]: conversation.awaitingSince } });
  };
  return {
    async run(now = new Date()) {
      const prefs = await Preferences.findOne({}).select("modules.messaging notify").lean();
      if (!prefs?.modules?.messaging?.isActive || !prefs.notify?.byTelegram?.isActive) return;
      let failure;
      for (const stage of STAGES) {
        const conversations = await Conversation.find({
          hidden: { $ne: true }, awaitingSince: { $ne: null, $lte: new Date(+now - stage.minutes * 60_000) },
          $expr: { $ne: [{ $ifNull: [`$${stage.field}`, null] }, "$awaitingSince"] },
        }).sort({ awaitingSince: 1 }).limit(100).lean();
        for (const conversation of conversations) {
          try { await runStage(conversation, stage, prefs); }
          catch (error) { failure ||= error; }
        }
      }
      if (failure) throw failure;
    },
    async isCurrent(notification) {
      const wait = notification.conversationWait;
      if (!wait?.conversationId) return true;
      const prefs = await Preferences.findOne({}).select("modules.messaging notify.byTelegram.isActive").lean();
      return Boolean(prefs?.modules?.messaging?.isActive && prefs.notify?.byTelegram?.isActive &&
        await Conversation.exists({ _id: wait.conversationId, awaitingSince: wait.awaitingSince, hidden: { $ne: true } }));
    },
  };
};

let notifier;
const production = () => (notifier ||= createWaitingNotifier({
  Conversation: require("@/models/conversation"), Message: require("@/models/message"),
  Ticket: require("@/models/ticket").Ticket, User: require("@/models/user"),
  Preferences: require("@/models/preferences"), Notification: require("@/models/notification"),
  authFor: require("@/services/authContext").buildAuthContext,
  fallbackRecipients: require("./notify").recipientsFor, baseUrl: process.env.ADDRESS,
}));
module.exports = {
  createWaitingNotifier,
  createWaitingNotifications: (now) => production().run(now),
  isWaitingNotificationCurrent: (notification) => notification.conversationWait?.conversationId ? production().isCurrent(notification) : true,
};
