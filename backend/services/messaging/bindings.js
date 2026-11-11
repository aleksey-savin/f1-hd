/**
 * Привязка личного чата к заявке: пока она жива, переписка идёт в заявку в обе
 * стороны. Закрытие заявки привязку заканчивает; возврат в работу возвращает
 * её там, где клиент уже написал после закрытия (вопрос «по заявке X?»).
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
      attachMode: { $nin: ["origin", "free"] },
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
      { _id: message._id, ticketId: null, attachMode: { $nin: ["free", "origin"] }, mappingIntent: { $exists: false } },
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

const bindConversation = async ({ conversation, ticket, by, attachPending = true, eventKind = "bound", onlyIfUnbound = false }) => {
  const Conversation = require("@/models/conversation");
  const { bindingsOf, activeBindings } = require("./multi-ticket");
  const now = new Date();
  const binding = { ticketId: ticket._id, ticketNum: ticket.num, boundAt: now, boundBy: by?._id || null, endedAt: null, endReason: null };
  let addedLink = true;
  if (onlyIfUnbound) {
    const claimed = await Conversation.updateOne(
      { _id: conversation._id,
        $or: [{ "binding.ticketId": null }, { "binding.endedAt": { $ne: null } }],
        ticketBindings: { $not: { $elemMatch: { ticketId: { $ne: null }, endedAt: null } } },
      },
      { $set: { binding, ticketBindings: [binding], decision: { ticketId: null, ticketNum: null, at: null } } },
    );
    if (!claimed.matchedCount) return false;
  } else {
    // One-time lazy migration is guarded: two managers cannot erase each other's links.
    await Conversation.updateOne({ _id: conversation._id, ticketBindings: { $exists: false } },
      { $set: { ticketBindings: bindingsOf(conversation).map((item) => ({ ...item })) } });
    const added = await Conversation.updateOne(
      { _id: conversation._id, ticketBindings: { $not: { $elemMatch: { ticketId: ticket._id, endedAt: null } } } },
      { $push: { ticketBindings: binding }, $set: { decision: { ticketId: null, ticketNum: null, at: null } } },
    );
    addedLink = Boolean(added.modifiedCount);
    // Legacy readers retain one compatible pointer; canonical links remain independent.
    await Conversation.updateOne({ _id: conversation._id, $or: [{ "binding.ticketId": null }, { "binding.endedAt": { $ne: null } }] },
      { $set: { binding } });
  }
  if (addedLink) await addSystemLine(conversation, { kind: eventKind, ticketNum: ticket.num, by });
  // Неотвеченное клиента — тоже в заявку: ради него и привязывают
  if (attachPending && conversation.awaitingSince) {
    const fresh = await Conversation.findById(conversation._id).lean();
    const links = activeBindings(fresh);
    if (links.length !== 1 || String(links[0].ticketId) !== String(ticket._id)) return true;
    const pending = await attachableSince(conversation._id, conversation.awaitingSince, ticket._id);
    await attachMessages({ conversation, messages: pending, ticket, mode: "bound" });
  }
  bus.bump({ topics: ["conversations"], ticketIds: [ticket._id] });
};

const unbindConversation = async ({ conversation, by, ticketNum, auth }) => {
  const { activeBindings, bindingsOf } = require("./multi-ticket");
  const selected = activeBindings(conversation).filter((binding) => ticketNum === undefined || binding.ticketNum === Number(ticketNum));
  if (!selected.length) return false;
  if (auth) {
    const tickets = await require("@/models/ticket").Ticket.find({ _id: { $in: selected.map((link) => link.ticketId) } }).lean();
    if (tickets.some((ticket) => !require("@/services/ticketAccess").canAccessTicket(ticket, auth))) {
      throw new (require("@/middleware/errorHandling").AppError)("Заявка не найдена", 404);
    }
  }
  const Conversation = require("@/models/conversation");
  await Conversation.updateOne({ _id: conversation._id, ticketBindings: { $exists: false } },
    { $set: { ticketBindings: bindingsOf(conversation) } });
  for (const binding of selected) {
    await Conversation.updateOne({ _id: conversation._id },
      { $set: { "ticketBindings.$[link].endedAt": new Date(), "ticketBindings.$[link].endReason": "manual" } },
      { arrayFilters: [{ "link.ticketId": binding.ticketId, "link.endedAt": null }] });
    await Conversation.updateOne({ _id: conversation._id, "binding.ticketId": binding.ticketId, "binding.endedAt": null },
      { $set: { "binding.endedAt": new Date(), "binding.endReason": "manual" } });
    await addSystemLine(conversation, { kind: "unbound", ticketNum: binding.ticketNum, by });
  }
  bus.bump({ topics: ["conversations"] });
  return true;
};

const endBindingsForTicket = async (ticketId, reason) => {
  const Conversation = require("@/models/conversation");
  const bound = await Conversation.find({ $or: [
    { "binding.ticketId": ticketId, "binding.endedAt": null },
    { ticketBindings: { $elemMatch: { ticketId, endedAt: null } } },
  ] }).lean();
  for (const conversation of bound) {
    const { bindingsOf } = require("./multi-ticket");
    const binding = bindingsOf(conversation).find((item) => String(item.ticketId) === String(ticketId) && !item.endedAt);
    if (!binding) continue;
    await Conversation.updateOne({ _id: conversation._id, ticketBindings: { $exists: false } }, { $set: { ticketBindings: bindingsOf(conversation) } });
    await Conversation.updateOne({ _id: conversation._id },
      { $set: { "ticketBindings.$[link].endedAt": new Date(), "ticketBindings.$[link].endReason": reason } },
      { arrayFilters: [{ "link.ticketId": ticketId, "link.endedAt": null }] });
    await Conversation.updateOne({ _id: conversation._id, "binding.ticketId": ticketId, "binding.endedAt": null },
      { $set: { "binding.endedAt": new Date(), "binding.endReason": reason } });
    await addSystemLine(conversation, { kind: "bindingEnded", ticketNum: binding.ticketNum });
  }
  if (bound.length) bus.bump({ topics: ["conversations"] });
};

const restoreBindingsAfterReopen = async (ticketId) => {
  const Conversation = require("@/models/conversation");
  const { Ticket } = require("@/models/ticket");
  const { bindingsOf, activeBindings } = require("./multi-ticket");
  const ticket = await Ticket.findById(ticketId).select("_id num applicantId isClosed").lean();
  if (!ticket || ticket.isClosed) return;
  const waiting = await Conversation.find({
    "decision.ticketId": ticketId,
    $or: [
      { "binding.ticketId": ticketId, "binding.endReason": "closed" },
      { ticketBindings: { $elemMatch: { ticketId, endReason: "closed" } } },
    ],
  }).lean();
  for (const conversation of waiting) {
    const binding = bindingsOf(conversation).find((link) => String(link.ticketId) === String(ticketId) && link.endReason === "closed");
    if (!binding) continue;
    const canonical = Array.isArray(conversation.ticketBindings);
    const restored = await Conversation.updateOne(
      { _id: conversation._id, "decision.ticketId": ticketId,
        ...(canonical ? { ticketBindings: { $elemMatch: { ticketId, endReason: "closed" } } } : { "binding.endReason": "closed" }) },
      { $set: {
        ...(canonical ? { "ticketBindings.$[link].endedAt": null, "ticketBindings.$[link].endReason": null }
          : { "binding.endedAt": null, "binding.endReason": null }),
        decision: { ticketId: null, ticketNum: null, at: null },
      } },
      canonical ? { arrayFilters: [{ "link.ticketId": ticketId, "link.endReason": "closed" }] } : {},
    );
    if (restored.modifiedCount !== 1) continue;
    if (canonical) await Conversation.updateOne({ _id: conversation._id, "binding.endedAt": { $ne: null } },
      { $set: { binding: { ...binding, endedAt: null, endReason: null } } });
    await addSystemLine(conversation, { kind: "bindingRestored", ticketNum: ticket.num });
    // Reopening one of several links never sweeps all unresolved messages into it.
    if (activeBindings(conversation).every((link) => String(link.ticketId) === String(ticketId))) {
      const after = await attachableSince(conversation._id, binding.endedAt, ticket._id);
      await attachMessages({ conversation, messages: after, ticket, mode: "bound" });
    }
  }
  if (waiting.length) bus.bump({ topics: ["conversations"], ticketIds: [ticketId] });
};

module.exports = { attachMessages, bindConversation, unbindConversation, endBindingsForTicket, restoreBindingsAfterReopen };
