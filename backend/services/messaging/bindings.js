/**
 * Привязка личного чата к заявке: пока она жива, переписка идёт в заявку в обе
 * стороны. Закрытие заявки привязку заканчивает; возврат в работу возвращает
 * её там, где клиент уже написал после закрытия (вопрос «по заявке №X?»).
 */
const { bus } = require("@/services/pulse");
const { addSystemLine, userTalksHere } = require("./conversationStore");
const { mirrorToTicket } = require("./mirror");

const loadPrefs = () => require("@/models/preferences").findOne({}).select("defaultApplicant").lean();

/**
 * Сообщения диалога, которые ещё можно прикрепить к заявке: без заявки, либо
 * уже заявлены за ЭТУ ЖЕ заявку, но зеркало тогда не создалось (упавший
 * `mirrorToTicket` — см. attachMessages) — их нужно домирроить, а не пропустить.
 */
const attachableSince = (conversationId, since, ticketId) =>
  require("@/models/message")
    .find({
      conversationId,
      $or: [{ ticketId: null }, { ticketId, commentId: null }],
      direction: { $in: ["in", "out"] },
      origin: { $ne: "hd" },
      imported: { $ne: true },
      // Сообщения attachMode:"origin" уже осознанно легли в описание заявки
      // (origin.js#applyOrigin) и своего комментария не имеют по замыслу, а не
      // по сбою — домирроивать их сюда не нужно (M3)
      attachMode: { $ne: "origin" },
      sentAt: { $gte: since },
    })
    .sort({ sentAt: 1, seq: 1 })
    .lean();

/** Сообщения — в заявку (зеркалами), по порядку. Уже прикреплённые пропускаются. */
const attachMessages = async ({ conversation, messages, ticket, mode }) => {
  const Message = require("@/models/message");
  const ChannelIdentity = require("@/models/channelIdentity");
  const Channel = require("@/models/channel");
  const prefs = await loadPrefs();
  const channel = await Channel.findById(conversation.channelId).lean();
  const skipApplicant = await userTalksHere(conversation, ticket.applicantId);
  let count = 0;
  for (const message of messages) {
    let claimed = await Message.findOneAndUpdate(
      { _id: message._id, ticketId: null },
      { $set: { ticketId: ticket._id, ticketNum: ticket.num, attachMode: mode } },
      { returnDocument: "after" },
    ).lean();
    if (!claimed) {
      // Не «ничьё»: если это уже эта заявка без комментария — прошлый вызов
      // заявил сообщение, но mirrorToTicket упал; домирроим его сейчас. Кроме
      // attachMode:"origin" — оно и должно остаться без комментария (M3)
      const current = await Message.findById(message._id).lean();
      if (!current || String(current.ticketId) !== String(ticket._id) || current.commentId || current.attachMode === "origin") continue;
      claimed = current;
    }
    const identity = claimed.identityId ? await ChannelIdentity.findById(claimed.identityId).lean() : null;
    await mirrorToTicket({ message: claimed, ticket, conversation, identity, channel, prefs, skipApplicant });
    count += 1;
  }
  return count;
};

const bindConversation = async ({ conversation, ticket, by, attachPending = true, eventKind = "bound" }) => {
  const Conversation = require("@/models/conversation");
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        binding: {
          ticketId: ticket._id,
          ticketNum: ticket.num,
          boundAt: new Date(),
          boundBy: by?._id || null,
          endedAt: null,
          endReason: null,
        },
        decision: { ticketId: null, ticketNum: null, at: null },
      },
    },
  );
  await addSystemLine(conversation, { kind: eventKind, ticketNum: ticket.num, by });
  // Неотвеченное клиента — тоже в заявку: ради него и привязывают
  if (attachPending && conversation.awaitingSince) {
    const pending = await attachableSince(conversation._id, conversation.awaitingSince, ticket._id);
    await attachMessages({ conversation, messages: pending, ticket, mode: "bound" });
  }
  bus.bump({ topics: ["conversations"], ticketIds: [ticket._id] });
};

const unbindConversation = async ({ conversation, by }) => {
  const Conversation = require("@/models/conversation");
  const updated = await Conversation.findOneAndUpdate(
    { _id: conversation._id, "binding.ticketId": { $ne: null }, "binding.endedAt": null },
    { $set: { "binding.endedAt": new Date(), "binding.endReason": "manual" } },
  ).lean();
  if (!updated) return false;
  await addSystemLine(conversation, { kind: "unbound", ticketNum: updated.binding.ticketNum, by });
  bus.bump({ topics: ["conversations"] });
  return true;
};

const endBindingsForTicket = async (ticketId, reason) => {
  const Conversation = require("@/models/conversation");
  const bound = await Conversation.find({ "binding.ticketId": ticketId, "binding.endedAt": null }).lean();
  for (const conversation of bound) {
    const ended = await Conversation.updateOne(
      { _id: conversation._id, "binding.endedAt": null },
      { $set: { "binding.endedAt": new Date(), "binding.endReason": reason } },
    );
    if (ended.modifiedCount) {
      await addSystemLine(conversation, { kind: "bindingEnded", ticketNum: conversation.binding.ticketNum });
    }
  }
  if (bound.length) bus.bump({ topics: ["conversations"] });
};

const restoreBindingsAfterReopen = async (ticketId) => {
  const Conversation = require("@/models/conversation");
  const { Ticket } = require("@/models/ticket");
  const ticket = await Ticket.findById(ticketId).select("_id num applicantId isClosed").lean();
  if (!ticket || ticket.isClosed) return;
  const waiting = await Conversation.find({
    "binding.ticketId": ticketId,
    "binding.endReason": "closed",
    "decision.ticketId": ticketId,
  }).lean();
  for (const conversation of waiting) {
    const since = conversation.binding.endedAt;
    // Условие повторяет то, по чему конверсация сюда попала: между чтением и
    // записью её могли отвязать или восстановить конкурентно — тогда не трогаем
    const restored = await Conversation.updateOne(
      { _id: conversation._id, "binding.endReason": "closed", "decision.ticketId": ticketId },
      {
        $set: {
          "binding.endedAt": null,
          "binding.endReason": null,
          decision: { ticketId: null, ticketNum: null, at: null },
        },
      },
    );
    if (restored.modifiedCount !== 1) continue;
    await addSystemLine(conversation, { kind: "bindingRestored", ticketNum: ticket.num });
    const after = await attachableSince(conversation._id, since, ticket._id);
    await attachMessages({ conversation, messages: after, ticket, mode: "bound" });
  }
  if (waiting.length) bus.bump({ topics: ["conversations"], ticketIds: [ticketId] });
};

module.exports = { attachMessages, bindConversation, unbindConversation, endBindingsForTicket, restoreBindingsAfterReopen };
