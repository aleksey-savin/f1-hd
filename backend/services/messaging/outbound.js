/**
 * Ответы из HD: из «Диалогов» (sendFromInbox) и из хроники заявки
 * (deliverComment). Порядок записи: комментарий (если ответ попадает в заявку)
 * → сообщение (уникальный commentId) → задание шлюзу. Сбой между шагами чинит
 * repairOutbound (крон раз в минуту, app.js).
 */
const rules = require("./rules");
const { commentChannel, userName } = require("./present");
const { nextSeq, userTalksHere } = require("./conversationStore");
const { enqueueJob } = require("./jobs");
const { bindConversation } = require("./bindings");

const fail = (message, status) => {
  const { AppError } = require("@/middleware/errorHandling");
  return new AppError(message, status);
};

const attachmentsOf = (files = []) =>
  (files || []).map((file) => ({
    name: file.key,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size || 0,
    status: "ready",
  }));

const kindOf = (text, attachments) => {
  if (text || !attachments.length) return "text";
  const type = attachments[0].mimetype || "";
  if (type.startsWith("image/")) return "photo";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return "document";
};

const channelFor = async (conversation) => {
  const Channel = require("@/models/channel");
  const channel = await Channel.findById(conversation.channelId).lean();
  if (!channel || !channel.isActive) throw fail("Канал отключён — ответить через него нельзя", 409);
  if (channel.type === "site") throw fail("Ответ на форму сайта появится вместе с почтовым ответом", 409);
  return channel;
};

const sendPayload = (conversation, text, attachments, recipient) => ({
  ...(conversation ? { chatId: conversation.externalChatId } : { recipient: { phone: recipient.phone } }),
  kind: conversation?.kind || "direct",
  text,
  attachments: attachments.map(({ name, originalName, mimetype, size }) => ({ name, originalName, mimetype, size })),
});

// A ticket reply handles only that ticket's pending client messages. Unresolved
// or other-ticket messages keep the shared waiting period for triage.
const clearWaitingForReply = async ({ conversation, ticket, discussionUserId, sentAt }) => {
  if (!conversation?.awaitingSince) return;
  if ((ticket || discussionUserId) && await require("@/models/message").exists({
    conversationId: conversation._id, direction: "in", origin: "client",
    imported: { $ne: true }, deletedAt: null,
    sentAt: { $gte: conversation.awaitingSince },
    ...(ticket ? { ticketId: { $ne: ticket._id } } : { $or: [{ ticketId: { $ne: null } }, { attachMode: { $ne: 'free' } }, { discussionUserId: { $ne: discussionUserId } }] }),
  })) return;
  await require("@/models/conversation").updateOne({
    _id: conversation._id, awaitingSince: conversation.awaitingSince,
    "lastMessage.at": { $lte: sentAt },
  }, { $set: { awaitingSince: null } });
};

/** Сообщение, задание шлюзу, сводка диалога и снятие «ждёт ответа». */
const queueOutbound = async ({ conversation, channel, text, attachments, author, ticket, comment, prefs, recipient, clientRequestId, withoutTicket = false, discussionUserId, replyToId, replyToExternalId, sticker = false }) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const { bus } = require("@/services/pulse");
  const now = new Date();
  const kind = sticker ? "sticker" : kindOf(text, attachments);
  const messageId = new (require("mongoose").Types.ObjectId)();
  const numbered = sticker ? "" : ticket ? [text, String(ticket.num)].filter(Boolean).join("\n\n") : text;
  const signed = !sticker && channel.settings?.signReplies
    ? rules.signReply(numbered, { firstName: author.firstName, organization: prefs?.contacts?.title || "" })
    : numbered;
  const intent = {
    _id: new (require("mongoose").Types.ObjectId)(),
    channelId: channel._id,
    network: channel.type,
    provider: require("./transport").providerOf(channel),
    type: "send",
    conversationId: conversation?._id || null,
    orderingKey: recipient?.phone || conversation?.deliveryPhone ? `phone:${channel._id}:${recipient?.phone || conversation.deliveryPhone}` : undefined,
    messageId,
    payload: { ...sendPayload(conversation, signed, attachments, recipient), ...(clientRequestId && conversation ? { startRequest: true } : {}), ...(replyToExternalId ? { replyToExternalId } : {}) },
  };
  const message = await Message.create({
    _id: messageId,
    jobId: intent._id,
    retryIntent: intent,
    conversationId: conversation?._id || null,
    channelId: channel._id,
    externalChatId: conversation?.externalChatId || `phone:${recipient.phone}`,
    seq: conversation ? await nextSeq(conversation._id) : 0,
    ...(recipient ? { recipientPhone: recipient.phone, recipientName: recipient.name, recipientUserId: recipient.userId || null } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
    direction: "out",
    origin: "hd",
    kind,
    authorUserId: author._id,
    authorName: userName(author),
    text,
    attachments,
    sentAt: now,
    status: "queued",
    ticketId: ticket?._id || null,
    ticketNum: ticket?.num ?? null,
    attachMode: ticket ? "deliver" : withoutTicket ? "free" : null,
    discussionUserId: !ticket && withoutTicket ? discussionUserId || author._id : null,
    replyToId: replyToId || null,
    replyToExternalId: replyToExternalId || null,
    commentId: comment?._id || null,
    effects: { conversation: true, attach: true, notify: true },
  });
  await enqueueRetryIntent({ _id: message._id, jobId: intent._id, retryIntent: intent });
  if (conversation) await Conversation.updateOne(
    { _id: conversation._id, $or: [{ "lastMessage.at": null }, { "lastMessage.at": { $lte: now } }] },
    {
      $set: {
        lastMessage: { at: now, direction: "out", origin: "hd", preview: rules.previewOf({ text, kind, attachments }), authorName: userName(author) },
      },
    },
  );
  // Ответили — диалог больше не ждёт
  if (conversation) await clearWaitingForReply({ conversation, ticket, discussionUserId: message.discussionUserId, sentAt: now });
  bus.bump({ topics: ["conversations"], ticketIds: ticket ? [ticket._id] : [] });
  return { ...message.toObject(), jobId: intent._id };
};

const markQueued = (commentId, messageId) =>
  require("@/models/comment").updateOne(
    { _id: commentId },
    {
      $set: { "channel.messageId": messageId, "channel.status": "queued", "channel.statusAt": new Date() },
      // Клиенту ошибка больше не видна — $set: undefined ничего не чистит, нужен $unset
      $unset: { "channel.error": 1 },
    },
  );

const sendFromInbox = async ({ conversationId, text, files = [], auth, ticketNum, withoutTicket = false, replyToId, stickerId }) => {
  const Conversation = require("@/models/conversation");
  const Comment = require("@/models/comment");
  const User = require("@/models/user");
  const Preferences = require("@/models/preferences");
  const { Ticket } = require("@/models/ticket");
  const storage = require("@/services/storage");
  const { markSeen } = require("@/services/ticketSeen");
  const { canSeeConversation } = require("./visibility");

  if (!require("./access").canReadInbox(auth) || !auth.can({ conversation: ["reply"] })) throw fail("Недостаточно прав, чтобы отвечать через мессенджер", 403);
  auth = { ...auth, messagingScope: await require("./access").loadMessageScope(auth) };
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation || !canSeeConversation(conversation, auth)) throw fail("Диалог не найден", 404);
  const body = String(text || "").trim();
  const channel = await channelFor(conversation);
  if (stickerId && (body || files.length)) throw fail("Стикер отправляется отдельным сообщением", 400);
  const attachments = stickerId ? [await require("./stickers").resolveSticker(stickerId, channel)] : attachmentsOf(files);
  if (!body && !attachments.length) throw fail("Пустое сообщение", 400);
  if (body.length > 20_000) throw fail("Сообщение длиннее 20 000 знаков", 400);
  const reply = await require("./reply-reference").validateReplyReference({ conversation, channel, replyToId, auth });
  const author = await User.findById(auth.userId).select("_id firstName lastName").lean();
  const prefs = await Preferences.findOne({}).select("contacts").lean();
  const ticket = await require("./reply-context").resolveReplyTicket({ conversation, auth, ticketNum, withoutTicket });

  let comment = null;
  if (ticket) {
    const copies = [];
    for (const attachment of attachments) {
      copies.push({ name: await storage.copyObject(attachment.name), originalName: attachment.originalName, mimetype: attachment.mimetype });
    }
    comment = await Comment.create({
      content: body || rules.commentContent({ kind: stickerId ? "sticker" : kindOf(body, attachments), attachments }),
      ticketId: ticket._id,
      attachments: copies,
      notifications: { lastAction: "new comment", pending: true, skipApplicant: await userTalksHere(conversation, ticket.applicantId), fromConversation: true },
      channel: commentChannel({ network: conversation.network, conversationId: conversation._id, direction: "out", status: "preparing" }),
      createdBy: author._id,
      updatedBy: author._id,
    });
    await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { comments: comment._id } });
    await markSeen(author._id, [ticket._id]).catch(() => {});
  }
  const effectiveWithoutTicket = withoutTicket || (!ticket && (await require("./reply-context").loadReplyContext({ conversation, auth })).withoutTicket);
  const message = await queueOutbound({ conversation, channel, text: body, attachments, author, ticket, comment, prefs, sticker: Boolean(stickerId), withoutTicket: effectiveWithoutTicket, ...reply });
  if (comment) await markQueued(comment._id, message._id);
  return message;
};

/** Проверяет действие отправки и текущую ответственность до записи комментария.
 * Членство в маршрутах заявки не даёт доступа ко всей истории диалога. */
const validateDeliverRoute = async ({ ticket, routeId, auth }) => {
  const Preferences = require("@/models/preferences");
  const Conversation = require("@/models/conversation");
  const { deliveryRoutes } = require("./origin");
  const prefs = await Preferences.findOne({}).select("modules.messaging").lean();
  if (!prefs?.modules?.messaging?.isActive) throw fail("Модуль «Диалоги» выключен", 409);
  if (!auth.can({ ticket: ["sendMessage"] }) && !(require("./access").canReadInbox(auth) && auth.can({ conversation: ["reply"] }))) throw fail("Недостаточно прав, чтобы отвечать через мессенджер", 403);
  if (!require("./access").canReplyToTicket(ticket, auth)) throw fail("Заявка недоступна для отправки", 403);
  const { routes } = await deliveryRoutes(ticket);
  const route = routes.find((item) => item.id === String(routeId));
  if (!route) throw fail("Канал ответа не найден", 404);
  if (!route.available) throw fail(`Ответить через этот диалог нельзя: ${route.reason}`, 409);
  if (route.target === "phone") {
    const { ticketRecipient } = require("./first-contact");
    const recipient = await ticketRecipient(ticket);
    if (!recipient) throw fail("У заявителя не указан действующий номер телефона", 409);
    const channel = await channelFor({ channelId: route.channelId });
    return { target: "phone", conversation: null, channel, recipient, skipApplicant: true };
  }
  const conversation = await Conversation.findById(route.conversationId).lean();
  if (!conversation) throw fail("Диалог не найден", 404);
  const channel = await channelFor(conversation);
  return { conversation, channel, skipApplicant: await userTalksHere(conversation, ticket.applicantId) };
};

/** Комментарий из хроники заявки уходит клиенту мессенджером. */
const deliverComment = async ({ comment, ticket, route, author }) => {
  const Preferences = require("@/models/preferences");
  const storage = require("@/services/storage");
  const { conversation, channel, recipient } = route;
  const prefs = await Preferences.findOne({}).select("contacts").lean();
  // Привязку создаём только для открытой заявки; доступ проверен до комментария.
  if (conversation?.kind === "direct" && !ticket.isClosed) {
    await bindConversation({ conversation, ticket, by: author, attachPending: false, onlyIfUnbound: false });
  }
  const attachments = [];
  for (const attachment of comment.attachments || []) {
    attachments.push({
      name: await storage.copyObject(attachment.name),
      originalName: attachment.originalName || "",
      mimetype: attachment.mimetype || "",
      size: 0,
      status: "ready",
    });
  }
  const message = await queueOutbound({ conversation, channel, text: comment.channel?.isSticker ? "" : comment.content, attachments, author, ticket, comment, prefs, recipient, sticker: Boolean(comment.channel?.isSticker) });
  await markQueued(comment._id, message._id);
  return message;
};

const retryMessage = async ({ messageId, auth }) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const ChannelJob = require("@/models/channelJob");
  const Comment = require("@/models/comment");
  const { Ticket } = require("@/models/ticket");
  const { bus } = require("@/services/pulse");
  const message = await Message.findById(messageId);
  if (!message || message.direction !== "out" || message.origin !== "hd") throw fail("Сообщение не найдено", 404);
  const conversation = message.conversationId ? await Conversation.findById(message.conversationId).lean() : null;
  if (!conversation && !message.recipientPhone) throw fail("Сообщение не найдено", 404);
  const prefs = await require("@/models/preferences").findOne({}).select("modules.messaging").lean();
  if (!prefs?.modules?.messaging?.isActive) throw fail("Модуль «Диалоги» выключен", 409);
  const { canReadInbox, readsAll, canReplyToTicket, canReadOwnDiscussion, canStartDiscussion } = require("./access");
  const inboxPermission = canReadInbox(auth) && auth.can({ conversation: ["reply"] });
  let allowed = false;
  if (message.ticketId) {
    const ticket = await Ticket.findById(message.ticketId).lean();
    allowed = Boolean((inboxPermission || auth.can({ ticket: ["sendMessage"] })) && canReplyToTicket(ticket, auth));
  } else if (inboxPermission && auth.can({ conversation: ["start"] }) && require("./start").isOwnStartRequest(message, auth) && !conversation?.hidden) {
    const recipient = await require("./start").recipientOf(message.recipientUserId ? { userId: String(message.recipientUserId) } : { phone: message.recipientPhone }, auth);
    allowed = recipient.phone === message.recipientPhone;
  } else if (conversation) {
    allowed = Boolean(inboxPermission && !conversation.hidden && (readsAll(auth) || (canStartDiscussion(auth) && canReadOwnDiscussion(message, auth))));
  }
  if (!allowed) throw fail("Сообщение не найдено", 404);
  if (message.status === "queued") return message.toObject();
  if (message.status !== "failed") throw fail("Повторять нечего: сообщение не в ошибке", 409);
  const channel = await channelFor(conversation || { channelId: message.channelId });
  const previous = message.jobId ? await ChannelJob.findById(message.jobId).lean() : null;
  const resume = message.recipientPhone && previous?.result?.chatId && !previous.result.sendComplete
    ? { ...previous.result, inFlightPart: null } : null;
  const intent = {
    _id: new (require("mongoose").Types.ObjectId)(),
    channelId: channel._id,
    network: channel.type,
    provider: require("./transport").providerOf(channel),
    type: "send",
    conversationId: conversation?._id || null,
    orderingKey: previous?.orderingKey,
    messageId: message._id,
    payload: previous?.payload || { ...sendPayload(conversation, message.text, message.attachments || [], { phone: message.recipientPhone }), ...(message.clientRequestId && !message.ticketId && conversation ? { startRequest: true } : {}), ...(message.replyToExternalId ? { replyToExternalId: message.replyToExternalId } : {}) },
    ...(resume ? { result: resume } : {}),
  };
  // Reserve one immutable job id before dispatch. Its full payload and progress
  // survive a crash on either side of enqueue; a competing retry cannot win twice.
  const claim = await Message.updateOne({ _id: message._id, status: "failed", jobId: message.jobId || null }, {
    $set: { status: "queued", error: "", jobId: intent._id, retryIntent: intent },
    ...(channel.provider === "wazzup" && !resume ? { $unset: { externalId: 1, externalIds: 1 } } : {}),
  });
  if (!claim.modifiedCount) {
    const current = await Message.findById(message._id);
    if (!current) throw fail("Сообщение не найдено", 404);
    return current.toObject();
  }
  if (message.commentId) {
    // $set: undefined ничего не чистит (Mongoose его вырезает) — нужен $unset
    await Comment.updateOne(
      { _id: message.commentId },
      { $set: { "channel.status": "queued", "channel.statusAt": new Date() }, $unset: { "channel.error": 1 } },
    );
  }
  await enqueueRetryIntent({ _id: message._id, jobId: intent._id, retryIntent: intent });
  bus.bump({ topics: ["conversations"], ticketIds: message.ticketId ? [message.ticketId] : [] });
  return (await Message.findById(message._id)).toObject();
};

/** The reserved job id is also the insertion idempotency key during recovery. */
const enqueueRetryIntent = async (message) => {
  const Message = require("@/models/message");
  const ChannelJob = require("@/models/channelJob");
  const intent = message.retryIntent;
  if (!intent) return;
  const existing = await ChannelJob.findById(intent._id).lean();
  if (!existing) {
    try { await enqueueJob(intent); } catch (error) {
      if (error.code !== 11000) throw error;
      const winner = await ChannelJob.findById(intent._id).lean();
      if (!winner || String(winner.messageId) !== String(message._id)) throw error;
    }
  }
  await Message.updateOne({ _id: message._id, jobId: intent._id }, { $unset: { retryIntent: 1 } });
};

/** Крон: ответы, застрявшие между комментарием, сообщением и заданием. */
const repairOutbound = async () => {
  const Message = require("@/models/message");
  const Comment = require("@/models/comment");
  const Conversation = require("@/models/conversation");
  const Channel = require("@/models/channel");
  const ChannelJob = require("@/models/channelJob");
  // Каналов нет вовсе (модуль выключен или ничего не подключено) — сканировать
  // нечего; без этого крон раз в минуту читал бы обе коллекции целиком впустую
  await require("./remap").repairMappings();
  if (!(await Channel.exists({ isActive: true }))) return;
  const cutoff = new Date(Date.now() - 60 * 1000);

  const retries = await Message.find({ direction: "out", origin: "hd", status: "queued", retryIntent: { $ne: null }, updatedAt: { $lte: cutoff } }).limit(50);
  for (const message of retries) await enqueueRetryIntent(message);

  const orphans = await Message.find({ direction: "out", origin: "hd", status: "queued", jobId: null, createdAt: { $lte: cutoff } }).limit(50);
  for (const message of orphans) {
    const conversation = message.conversationId ? await Conversation.findById(message.conversationId).lean() : null;
    const channel = await Channel.findById(conversation?.channelId || message.channelId).lean();
    if (!channel?.isActive) {
      message.status = "failed";
      message.error = "Канал отключён";
      await message.save();
      continue;
    }
    // Сбой мог случиться уже ПОСЛЕ enqueueJob (до записи jobId в сообщение,
    // см. queueOutbound) — задание тогда уже есть, второе плодить не нужно
    const existing = await ChannelJob.findOne({ messageId: message._id }).sort({ createdAt: -1 }).lean();
    if (existing) {
      await Message.updateOne({ _id: message._id, jobId: null }, { $set: { jobId: existing._id } });
      continue;
    }
    const job = await enqueueJob({
      channelId: channel._id,
      network: channel.type,
      provider: require("./transport").providerOf(channel),
      type: "send",
      conversationId: conversation?._id || null,
      orderingKey: message.recipientPhone ? `phone:${channel._id}:${message.recipientPhone}` : undefined,
      messageId: message._id,
      payload: sendPayload(conversation, message.text, message.attachments || [], { phone: message.recipientPhone }),
    });
    message.jobId = job._id;
    await message.save();
  }

  const stuck = await Comment.find({ "channel.status": "preparing", createdAt: { $lte: cutoff } }).select("_id").limit(50).lean();
  for (const comment of stuck) {
    const message = await Message.findOne({ commentId: comment._id }).select("_id status").lean();
    await Comment.updateOne(
      { _id: comment._id },
      {
        $set: message
          ? { "channel.messageId": message._id, "channel.status": message.status }
          : { "channel.status": "failed", "channel.error": "Не отправлено: сбой при постановке в очередь" },
      },
    );
  }
};

module.exports = { clearWaitingForReply, attachmentsOf, kindOf, queueOutbound, sendFromInbox, validateDeliverRoute, deliverComment, retryMessage, repairOutbound };
