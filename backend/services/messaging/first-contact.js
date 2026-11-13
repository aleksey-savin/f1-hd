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

const findPhoneConversations = async (phone, channelId, userId) => {
  const identities = await require("@/models/channelIdentity").find(userId ? { $or: [{ phone }, { userId }] } : { phone }).select("_id").lean();
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
  const ticket = message.ticketId ? await Ticket.findById(message.ticketId).lean() : null;
  if (message.ticketId && !ticket) return { reason: "Заявка удалена — сообщение не отправлено" };
  let auth = null;
  {
    const author = await require("@/models/user").findById(message.authorUserId);
    const { buildAuthContext, isDeniedAccount } = require("@/services/authContext");
    if (!author || isDeniedAccount(author)) return { reason: "Сотрудник отключён — сообщение не отправлено" };
    auth = await buildAuthContext(author);
    if (ticket && ((!auth.can({ ticket: ["sendMessage"] }) && !(require("./access").canReadInbox(auth) && auth.can({ conversation: ["reply"] }))) || !require("./access").canReplyToTicket(ticket, auth))) return { reason: "Заявка недоступна для отправки" };
  }
  if (!message.ticketId) {
    try {
      const { requireStartAccess, recipientOf } = require("./start");
      await requireStartAccess(auth);
      const current = await recipientOf(message.recipientUserId ? { userId: String(message.recipientUserId) } : { phone: message.recipientPhone }, auth);
      if (current && current.phone !== message.recipientPhone) return { reason: "Номер получателя изменился — сообщение не отправлено" };
      const reason = firstContactReason(channel, { phone: message.recipientPhone });
      if (reason) return { reason };
    } catch (error) {
      return { reason: error.statusCode && error.statusCode < 500 ? error.message : "Не удалось проверить права отправки" };
    }
  }
  if (!ticket) auth = { ...auth, messagingScope: await require("./access").loadMessageScope(auth) };
  const allConversations = await findPhoneConversations(message.recipientPhone, ticket ? channel._id : null, message.recipientUserId);
  const conversations = allConversations.filter(conversation => String(conversation.channelId) === String(channel._id));
  const inspectedConversations = ticket ? conversations : allConversations;
  for (const conversation of inspectedConversations) {
    if (conversation.hidden) return { reason: "Диалог скрыт — сообщение не отправлено" };
    const continuesOwnStart = !ticket && require("./start").isOwnStartRequest(message, auth)
      && String(message.conversationId) === String(conversation._id)
      && String(message.channelId) === String(channel._id)
      && String(conversation.channelId) === String(channel._id)
      && job.result?.chatId === conversation.externalChatId
      && (job.result?.nextPart > 0 || job.result?.externalIds?.length > 0);
    const ownDiscussion = !ticket && require("./access").canReadOwnDiscussion(message, auth) && require("./start").isOwnStartRequest(message, auth);
    if (!ticket && !ownDiscussion && !continuesOwnStart && !require("./visibility").canSeeConversation(conversation, auth)) return { reason: "Диалог недоступен — сообщение не отправлено" };
    const bindings = require("./multi-ticket").activeBindings(conversation);
    for (const binding of bindings) if (ticket && binding.ticketId && !binding.endedAt && String(binding.ticketId) !== String(ticket?._id)) {
      const bound = await Ticket.findById(binding.ticketId).select("isClosed").lean();
      if (bound && !bound.isClosed) return { reason: `Диалог занят заявкой ${binding.ticketNum} — сообщение не отправлено` };
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
      network: channel.type, stickersAvailable: channel.type === "telegram" && channel.provider === "wazzup", kind: "direct", title: channel.name || "", boundHere: false, available: !reason, reason };
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
  const ticket = message.ticketId ? await Ticket.findById(message.ticketId).lean() : null;
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
  if (message.commentId) await Comment.updateOne({ _id: message.commentId }, { $set: { "channel.conversationId": conversation._id, "channel.messageId": message._id } });
  const orderingKey = `phone:${channel._id}:${message.recipientPhone}`;
  await ChannelJob.updateMany({ $or: [{ _id: job._id }, { conversationId: conversation._id, state: "pending" }] },
    { $set: { orderingKey } });
  await ChannelJob.updateOne({ _id: job._id }, { $set: { conversationId: conversation._id } });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { deliveryPhone: message.recipientPhone } });
  const binding = conversation.binding || {};
  // Существующую чужую привязку никогда не перехватываем.
  if (ticket && !ticket.isClosed && (!binding.ticketId || binding.endedAt)) {
    await require("./bindings").bindConversation({ conversation, ticket, by: { _id: message.authorUserId, firstName: message.authorName }, attachPending: false, onlyIfUnbound: true });
  }
  await Conversation.updateOne({ _id: conversation._id, $or: [{ "lastMessage.at": null }, { "lastMessage.at": { $lte: message.sentAt } }] },
    { $set: { lastMessage: { at: message.sentAt, direction: "out", origin: "hd", preview: require("./rules").previewOf(message), authorName: message.authorName } } });
  if (ticket) await require("./outbound").clearWaitingForReply({ conversation, ticket, sentAt: message.sentAt });
  require("@/services/pulse").bus.bump({ topics: ["conversations"], ticketIds: message.ticketId ? [message.ticketId] : [] });
};

module.exports = { ticketRecipient, firstContactReason, phoneRoutes, findPhoneConversations, inspectPhoneJob, attachFirstContact };
