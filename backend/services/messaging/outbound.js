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

const openBoundTicket = async (conversation) => {
  const binding = conversation.binding || {};
  if (conversation.kind !== "direct" || !binding.ticketId || binding.endedAt) return null;
  const { Ticket } = require("@/models/ticket");
  const ticket = await Ticket.findById(binding.ticketId).select("_id num applicantId isClosed").lean();
  return ticket && !ticket.isClosed ? ticket : null;
};

const sendPayload = (conversation, text, attachments) => ({
  chatId: conversation.externalChatId,
  kind: conversation.kind,
  text,
  attachments: attachments.map(({ name, originalName, mimetype, size }) => ({ name, originalName, mimetype, size })),
});

/** Сообщение, задание шлюзу, сводка диалога и снятие «ждёт ответа». */
const queueOutbound = async ({ conversation, channel, text, attachments, author, ticket, comment, prefs }) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const { bus } = require("@/services/pulse");
  const now = new Date();
  const kind = kindOf(text, attachments);
  const message = await Message.create({
    conversationId: conversation._id,
    channelId: channel._id,
    externalChatId: conversation.externalChatId,
    seq: await nextSeq(conversation._id),
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
    attachMode: ticket ? "deliver" : null,
    commentId: comment?._id || null,
    effects: { conversation: true, attach: true, notify: true },
  });
  const signed = channel.settings?.signReplies
    ? rules.signReply(text, { firstName: author.firstName, organization: prefs?.contacts?.title || "" })
    : text;
  const job = await enqueueJob({
    channelId: channel._id,
    network: channel.type,
    type: "send",
    conversationId: conversation._id,
    messageId: message._id,
    payload: sendPayload(conversation, signed, attachments),
  });
  await Message.updateOne({ _id: message._id }, { $set: { jobId: job._id } });
  await Conversation.updateOne(
    { _id: conversation._id, $or: [{ "lastMessage.at": null }, { "lastMessage.at": { $lte: now } }] },
    {
      $set: {
        lastMessage: { at: now, direction: "out", origin: "hd", preview: rules.previewOf({ text, kind, attachments }), authorName: userName(author) },
      },
    },
  );
  // Ответили — диалог больше не ждёт
  await Conversation.updateOne({ _id: conversation._id, awaitingSince: { $ne: null } }, { $set: { awaitingSince: null } });
  bus.bump({ topics: ["conversations"], ticketIds: ticket ? [ticket._id] : [] });
  return { ...message.toObject(), jobId: job._id };
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

const sendFromInbox = async ({ conversationId, text, files = [], auth }) => {
  const Conversation = require("@/models/conversation");
  const Comment = require("@/models/comment");
  const User = require("@/models/user");
  const Preferences = require("@/models/preferences");
  const { Ticket } = require("@/models/ticket");
  const storage = require("@/services/storage");
  const { markSeen } = require("@/services/ticketSeen");
  const { canSeeConversation } = require("./visibility");

  if (!auth.can({ conversation: ["reply"] })) throw fail("Недостаточно прав, чтобы отвечать через мессенджер", 403);
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation || !canSeeConversation(conversation, auth)) throw fail("Диалог не найден", 404);
  const body = String(text || "").trim();
  const attachments = attachmentsOf(files);
  if (!body && !attachments.length) throw fail("Пустое сообщение", 400);
  if (body.length > 20_000) throw fail("Сообщение длиннее 20 000 знаков", 400);
  const channel = await channelFor(conversation);
  const author = await User.findById(auth.userId).select("_id firstName lastName").lean();
  const prefs = await Preferences.findOne({}).select("contacts").lean();
  const ticket = await openBoundTicket(conversation);

  let comment = null;
  if (ticket) {
    const copies = [];
    for (const attachment of attachments) {
      copies.push({ name: await storage.copyObject(attachment.name), originalName: attachment.originalName, mimetype: attachment.mimetype });
    }
    comment = await Comment.create({
      content: body || rules.commentContent({ kind: kindOf(body, attachments), attachments }),
      ticketId: ticket._id,
      attachments: copies,
      notifications: { lastAction: "new comment", pending: true, skipApplicant: await userTalksHere(conversation, ticket.applicantId) },
      channel: commentChannel({ network: conversation.network, conversationId: conversation._id, direction: "out", status: "preparing" }),
      createdBy: author._id,
      updatedBy: author._id,
    });
    await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { comments: comment._id } });
    await markSeen(author._id, [ticket._id]).catch(() => {});
  }
  const message = await queueOutbound({ conversation, channel, text: body, attachments, author, ticket, comment, prefs });
  if (comment) await markQueued(comment._id, message._id);
  return message;
};

/**
 * Проверка «Ответить через» до записи комментария. Видимость диалога здесь не
 * спрашиваем: заявка уже проверена вызывающим (controllers/comment.js), а
 * право отвечать даёт ЧЛЕНСТВО В МАРШРУТАХ этой заявки (deliveryRoutes) — иначе
 * свой-ярусный исполнитель заявки с компанией получал бы 404 на предложенный
 * тем же deliveryRoutes маршрут (I1). Общие ярусы видимости инбокса это не
 * расширяет — они остаются как есть (P1).
 */
const validateDeliverRoute = async ({ ticket, conversationId, auth }) => {
  const Preferences = require("@/models/preferences");
  const Conversation = require("@/models/conversation");
  const { deliveryRoutes } = require("./origin");
  const prefs = await Preferences.findOne({}).select("modules.messaging").lean();
  if (!prefs?.modules?.messaging?.isActive) throw fail("Модуль «Диалоги» выключен", 409);
  if (!auth.can({ conversation: ["reply"] })) throw fail("Недостаточно прав, чтобы отвечать через мессенджер", 403);
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) throw fail("Диалог не найден", 404);
  const { routes } = await deliveryRoutes(ticket);
  const route = routes.find((item) => item.conversationId === String(conversation._id));
  if (!route) throw fail("Диалог не найден", 404);
  if (!route.available) throw fail(`Ответить через этот диалог нельзя: ${route.reason}`, 409);
  const channel = await channelFor(conversation);
  return { conversation, channel, skipApplicant: await userTalksHere(conversation, ticket.applicantId) };
};

/** Комментарий из хроники заявки уходит клиенту мессенджером. */
const deliverComment = async ({ comment, ticket, route, author }) => {
  const Preferences = require("@/models/preferences");
  const storage = require("@/services/storage");
  const { conversation, channel } = route;
  const prefs = await Preferences.findOne({}).select("contacts").lean();
  const binding = conversation.binding || {};
  // Закрытую заявку не привязываем (M4) — отправка при этом всё равно идёт
  if (conversation.kind === "direct" && !ticket.isClosed && (!binding.ticketId || binding.endedAt)) {
    await bindConversation({ conversation, ticket, by: author, attachPending: true });
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
  const message = await queueOutbound({ conversation, channel, text: comment.content, attachments, author, ticket, comment, prefs });
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
  const { canSeeConversation } = require("./visibility");
  const { canAccessTicket } = require("@/services/ticketAccess");
  if (!auth.can({ conversation: ["reply"] })) throw fail("Недостаточно прав, чтобы отвечать через мессенджер", 403);
  const message = await Message.findById(messageId);
  if (!message || message.direction !== "out" || message.origin !== "hd") throw fail("Сообщение не найдено", 404);
  const conversation = await Conversation.findById(message.conversationId).lean();
  if (!conversation) throw fail("Сообщение не найдено", 404);
  // Видимость диалога ИЛИ доступ к заявке, за которой оно числится (I1): своя
  // заявка своего яруса даёт право повторить попавший в неё ответ, даже если
  // общая видимость диалога (компания) отказала бы
  let allowed = canSeeConversation(conversation, auth);
  if (!allowed && message.ticketId) {
    const ticket = await Ticket.findById(message.ticketId).select("_id responsibles createdBy applicantId applicant company").lean();
    allowed = canAccessTicket(ticket, auth);
  }
  if (!allowed) throw fail("Сообщение не найдено", 404);
  if (message.status !== "failed") throw fail("Повторять нечего: сообщение не в ошибке", 409);
  const channel = await channelFor(conversation);
  const previous = message.jobId ? await ChannelJob.findById(message.jobId).lean() : null;
  const job = await enqueueJob({
    channelId: channel._id,
    network: channel.type,
    type: "send",
    conversationId: conversation._id,
    messageId: message._id,
    payload: previous?.payload || sendPayload(conversation, message.text, message.attachments || []),
  });
  // Повтор — единственный путь назад из «failed»: статус ставим прямо
  message.jobId = job._id;
  message.status = "queued";
  message.error = "";
  await message.save();
  if (message.commentId) {
    // $set: undefined ничего не чистит (Mongoose его вырезает) — нужен $unset
    await Comment.updateOne(
      { _id: message.commentId },
      { $set: { "channel.status": "queued", "channel.statusAt": new Date() }, $unset: { "channel.error": 1 } },
    );
  }
  bus.bump({ topics: ["conversations"], ticketIds: message.ticketId ? [message.ticketId] : [] });
  return message.toObject();
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
  if (!(await Channel.exists({ isActive: true }))) return;
  const cutoff = new Date(Date.now() - 60 * 1000);

  const orphans = await Message.find({ direction: "out", origin: "hd", status: "queued", jobId: null, createdAt: { $lte: cutoff } }).limit(50);
  for (const message of orphans) {
    const conversation = await Conversation.findById(message.conversationId).lean();
    const channel = conversation ? await Channel.findById(conversation.channelId).lean() : null;
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
      type: "send",
      conversationId: conversation._id,
      messageId: message._id,
      payload: sendPayload(conversation, message.text, message.attachments || []),
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

module.exports = { attachmentsOf, kindOf, sendFromInbox, validateDeliverRoute, deliverComment, retryMessage, repairOutbound };
