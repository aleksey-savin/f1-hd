const { isValidPhone, toCanonicalPhone } = require("../phone");
const { userName } = require("./present");

/** Адрес берётся из заявки и карточки заявителя, никогда из тела отправки. */
const ticketRecipient = async (ticket) => {
  const id = ticket.applicantId?._id || ticket.applicantId || ticket.applicant?._id;
  const user = id
    ? await require("@/models/user").findById(id).select("firstName lastName phone deletedAt banned isServiceAccount").lean()
    : ticket.applicant;
  if (!user || user.deletedAt || user.banned || user.isServiceAccount) return null;
  const phone = toCanonicalPhone(user.phone || "");
  return isValidPhone(phone) ? { phone, name: userName(user) } : null;
};

const firstContactReason = (channel, recipient) => {
  if (!recipient) return "У заявителя не указан действующий номер телефона";
  if (channel.provider !== "wazzup") return "Первое сообщение по номеру недоступно для этого подключения";
  if (["telegram", "maxbot"].includes(channel.providerTransport)) return "Бот не может написать первым — клиент должен начать диалог";
  if (channel.providerTransport === "wapi") return "Для первого сообщения нужен согласованный шаблон WhatsApp Business";
  if (!["tgapi", "whatsapp", "max"].includes(channel.providerTransport)) return "Канал не поддерживает первое сообщение по номеру";
  return null;
};

const findPhoneConversations = async (phone, channelId) => {
  const identities = await require("@/models/channelIdentity").find({ phone }).select("_id").lean();
  return require("@/models/conversation").find({ kind: "direct", ...(channelId ? { channelId } : {}), $or: [
    { deliveryPhone: phone }, { counterpartIdentityId: { $in: identities.map((identity) => identity._id) } },
  ] }).lean();
};

/** Очередь могла ждать, пока другой ответ уже создал и занял тот же чат.
 * Проверка непосредственно перед HTTP-отправкой закрывает этот промежуток. */
const inspectPhoneJob = async (job, channel) => {
  const Message = require("@/models/message");
  const { Ticket } = require("@/models/ticket");
  const message = await Message.findById(job.messageId).lean();
  if (!message?.recipientPhone) return { reason: "Получатель первого сообщения не найден" };
  const ticket = await Ticket.findById(message.ticketId).lean();
  if (!ticket) return { reason: "Заявка удалена — сообщение не отправлено" };
  const conversations = await findPhoneConversations(message.recipientPhone, channel._id);
  for (const conversation of conversations) {
    if (conversation.hidden) return { reason: "Диалог скрыт — сообщение не отправлено" };
    const binding = conversation.binding || {};
    if (binding.ticketId && !binding.endedAt && String(binding.ticketId) !== String(ticket._id)) {
      const bound = await Ticket.findById(binding.ticketId).select("isClosed").lean();
      if (bound && !bound.isClosed) return { reason: `Диалог занят заявкой №${binding.ticketNum} — сообщение не отправлено` };
    }
  }
  return { conversation: conversations[0] || null };
};

const phoneRoutes = async (ticket, conversations, recipient) => {
  const Channel = require("@/models/channel");
  const channels = await Channel.find({ isActive: true, type: { $in: ["telegram", "whatsapp", "max"] } })
    .select("type name provider providerTransport state isActive").lean();
  return channels.filter((channel) => !conversations.some((conversation) =>
    conversation.kind === "direct" && String(conversation.channelId) === String(channel._id),
  )).map((channel) => {
    const reason = firstContactReason(channel, recipient);
    return { id: `phone:${channel._id}`, target: "phone", channelId: String(channel._id), conversationId: null,
      network: channel.type, kind: "direct", title: channel.name || "", boundHere: false, available: !reason, reason };
  });
};

/** Принятый провайдером первый ответ получает настоящий диалог. Каждый шаг
 * можно повторить после сбоя: уникальные ключи диалога/комментария сохраняются. */
const attachFirstContact = async (job, channel, result) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const Comment = require("@/models/comment");
  const ChannelJob = require("@/models/channelJob");
  const { Ticket } = require("@/models/ticket");
  const { nextSeq } = require("./conversationStore");
  const message = await Message.findById(job.messageId).lean();
  if (!message?.recipientPhone) return;
  const ticket = await Ticket.findById(message.ticketId).lean();
  const identity = await require("./identity").resolveIdentity(channel.type, {
    id: `wazzup:${channel.providerChannelId}:${result.chatId}`, phone: message.recipientPhone,
  }, require("./identity").modelDeps());
  const conversation = await require("./ingest").upsertConversation(channel,
    { id: result.chatId, kind: "direct", title: message.recipientName || "" }, identity);
  if (!message.conversationId) {
    await Message.updateOne({ _id: message._id, conversationId: null }, { $set: {
      conversationId: conversation._id, externalChatId: result.chatId, seq: await nextSeq(conversation._id),
    } });
  }
  await Comment.updateOne({ _id: message.commentId }, { $set: { "channel.conversationId": conversation._id, "channel.messageId": message._id } });
  const orderingKey = `phone:${channel._id}:${message.recipientPhone}`;
  await ChannelJob.updateMany({ $or: [{ _id: job._id }, { conversationId: conversation._id, state: "pending" }] },
    { $set: { orderingKey } });
  await ChannelJob.updateOne({ _id: job._id }, { $set: { conversationId: conversation._id } });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { deliveryPhone: message.recipientPhone } });
  const binding = conversation.binding || {};
  // Существующую чужую привязку никогда не перехватываем.
  if (ticket && !ticket.isClosed && (!binding.ticketId || binding.endedAt)) {
    await require("./bindings").bindConversation({ conversation, ticket, by: { _id: message.authorUserId, firstName: message.authorName }, attachPending: true, onlyIfUnbound: true });
  }
  await Conversation.updateOne({ _id: conversation._id, $or: [{ "lastMessage.at": null }, { "lastMessage.at": { $lte: message.sentAt } }] },
    { $set: { lastMessage: { at: message.sentAt, direction: "out", origin: "hd", preview: require("./rules").previewOf(message), authorName: message.authorName } } });
  await Conversation.updateOne({ _id: conversation._id, awaitingSince: { $lte: message.sentAt } }, { $set: { awaitingSince: null } });
  require("@/services/pulse").bus.bump({ topics: ["conversations"], ticketIds: message.ticketId ? [message.ticketId] : [] });
};

module.exports = { ticketRecipient, firstContactReason, phoneRoutes, findPhoneConversations, inspectPhoneJob, attachFirstContact };
