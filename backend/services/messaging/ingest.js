/**
 * Единый вход событий каналов: шлюз (Telegram, WhatsApp), вебхук MAX, форма
 * сайта. Событие уже проверено (events.js). Каждый шаг повторяем: повтор
 * доставки находит сообщение по уникальному индексу и доделывает только шаги
 * без отметки в `effects` — транзакций у standalone-MongoDB нет.
 */
const rules = require("./rules");
const { resolveIdentity, modelDeps } = require("./identity");
const { nextSeq, addSystemLine, userTalksHere, displayNameFor } = require("./conversationStore");
const { mirrorToTicket } = require("./mirror");
const { notifyWaiting } = require("./notify");

let identityDeps = null;
const deps = () => (identityDeps ||= modelDeps());

const m = () => ({
  Channel: require("@/models/channel"),
  Conversation: require("@/models/conversation"),
  Message: require("@/models/message"),
  ChannelIdentity: require("@/models/channelIdentity"),
  Comment: require("@/models/comment"),
  Preferences: require("@/models/preferences"),
  Ticket: require("@/models/ticket").Ticket,
});

const bump = (ticketIds = []) => require("@/services/pulse").bus.bump({ topics: ["conversations"], ticketIds });

const deviceName = (channel) => `${channel.account?.displayName || channel.name} · с телефона`;

const markEffect = (messageId, effect) =>
  m().Message.updateOne({ _id: messageId }, { $set: { [`effects.${effect}`]: true } });

const upsertConversation = async (channel, chat, counterpart) => {
  const { Conversation } = m();
  const filter = { channelId: channel._id, externalChatId: chat.id };
  const set = {};
  if (chat.title) set.title = chat.title;
  if (chat.kind === "direct" && counterpart) set.counterpartIdentityId = counterpart._id;
  const update = {
    $setOnInsert: { channelId: channel._id, network: channel.type, kind: chat.kind, externalChatId: chat.id },
    ...(Object.keys(set).length ? { $set: set } : {}),
  };
  let conversation;
  try {
    conversation = await Conversation.findOneAndUpdate(filter, update, { upsert: true, returnDocument: "after" }).lean();
  } catch (error) {
    // Два события нового чата разом: второй upsert упирается в уникальный индекс
    if (error?.code !== 11000) throw error;
    conversation = await Conversation.findOneAndUpdate(filter, { ...(Object.keys(set).length ? { $set: set } : {}) }, { returnDocument: "after" }).lean();
  }
  if (!conversation.companyId && counterpart?.companyId) {
    conversation =
      (await Conversation.findOneAndUpdate(
        { _id: conversation._id, companyId: null },
        { $set: { companyId: counterpart.companyId } },
        { returnDocument: "after" },
      ).lean()) || conversation;
  }
  return conversation;
};

const addParticipant = async (conversation, identity) => {
  if (conversation.kind !== "group" || !identity) return;
  await m().Conversation.updateOne(
    { _id: conversation._id, "participants.identityId": { $ne: identity._id } },
    { $push: { participants: { identityId: identity._id, isStaff: Boolean(identity.isStaff) } } },
  );
};

const insertMessage = async ({ channel, conversation, event, identity }) => {
  const { Message } = m();
  const msg = event.message;
  const key = { channelId: channel._id, externalChatId: event.chat.id, externalId: msg.id };
  const existing = await Message.findOne(key).lean();
  if (existing) return existing;
  const origin = msg.direction === "in" ? (msg.origin === "form" ? "form" : identity?.isStaff && event.chat.kind === "group" ? "staff" : "client") : "device";
  const replyTo = msg.replyToId
    ? await Message.findOne({ channelId: channel._id, externalChatId: event.chat.id, externalId: msg.replyToId }).select("_id").lean()
    : null;
  try {
    const created = await Message.create({
      ...key,
      conversationId: conversation._id,
      seq: await nextSeq(conversation._id),
      direction: msg.direction,
      origin,
      kind: msg.kind,
      identityId: identity?._id || null,
      authorName: origin === "device" ? deviceName(channel) : "",
      text: msg.text,
      attachments: msg.attachments,
      form: msg.form || undefined,
      replyToExternalId: msg.replyToId,
      replyToId: replyTo?._id || null,
      sentAt: msg.sentAt,
      status: msg.direction === "out" ? "sent" : "received",
      imported: msg.imported,
    });
    return created.toObject();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return Message.findOne(key).lean();
  }
};

const applyConversationEffects = async (conversation, message, identity) => {
  const { Conversation, Channel } = m();
  const authorName = message.direction === "in" ? await displayNameFor(identity) : message.authorName;
  await Conversation.updateOne(
    { _id: conversation._id, $or: [{ "lastMessage.at": null }, { "lastMessage.at": { $lte: message.sentAt } }] },
    {
      $set: {
        lastMessage: {
          at: message.sentAt,
          direction: message.direction,
          origin: message.origin,
          preview: rules.previewOf(message),
          authorName,
        },
      },
    },
  );
  const next = rules.nextAwaiting(conversation, message);
  if (next?.awaitingSince) {
    await Conversation.updateOne(
      { _id: conversation._id, awaitingSince: null },
      { $set: { awaitingSince: next.awaitingSince, handled: { at: null, by: null, how: null } } },
    );
  } else if (next) {
    await Conversation.updateOne(
      { _id: conversation._id, awaitingSince: { $lte: message.sentAt } },
      { $set: { awaitingSince: null } },
    );
  }
  await Channel.updateOne(
    { _id: conversation.channelId, $or: [{ lastMessageAt: null }, { lastMessageAt: { $lte: message.sentAt } }] },
    { $set: { lastMessageAt: message.sentAt } },
  );
};

const ticketOfReply = async (replyToId) => {
  const { Message, Ticket } = m();
  const replied = await Message.findById(replyToId).select("ticketId").lean();
  return replied?.ticketId ? Ticket.findById(replied.ticketId).select("_id num isClosed applicantId").lean() : null;
};

const applyAttach = async ({ channel, conversation, message, identity }) => {
  const { Conversation, Message, Ticket, Preferences } = m();
  const fresh = await Conversation.findById(conversation._id).lean();
  const binding = fresh.binding || {};
  const boundTicket =
    binding.ticketId && !binding.endedAt
      ? await Ticket.findById(binding.ticketId).select("_id num isClosed applicantId").lean()
      : null;
  const replyToTicket = fresh.kind === "group" && message.replyToId ? await ticketOfReply(message.replyToId) : null;
  const verdict = rules.decideAttach({ conversation: fresh, message, boundTicket, replyToTicket });

  if (verdict.endBinding) {
    const ended = await Conversation.updateOne(
      { _id: fresh._id, "binding.endedAt": null },
      { $set: { "binding.endedAt": new Date(), "binding.endReason": verdict.endBinding } },
    );
    if (ended.modifiedCount) await addSystemLine(fresh, { kind: "bindingEnded", ticketNum: binding.ticketNum });
  }
  if (verdict.decision) {
    await Conversation.updateOne({ _id: fresh._id }, { $set: { decision: { ...verdict.decision, at: new Date() } } });
  }
  if (verdict.suggestTicketId) {
    await Message.updateOne({ _id: message._id }, { $set: { suggestTicketId: verdict.suggestTicketId } });
  }
  if (!verdict.mode) return;

  const claimed = await Message.findOneAndUpdate(
    { _id: message._id, ticketId: null },
    { $set: { ticketId: verdict.ticketId, ticketNum: verdict.ticketNum, attachMode: verdict.mode } },
    { returnDocument: "after" },
  ).lean();
  let target = claimed;
  if (!target) {
    target = await Message.findById(message._id).lean();
    // Заявлено за другую заявку конкурентно (например, ручной привязкой) —
    // зеркалить в verdict.ticketId уже нельзя, сообщение не про неё
    if (String(target.ticketId) !== String(verdict.ticketId)) return;
  }
  const ticket = await Ticket.findById(verdict.ticketId).select("_id num applicantId").lean();
  const prefs = await Preferences.findOne({}).select("defaultApplicant").lean();
  await mirrorToTicket({
    message: target,
    ticket,
    conversation: fresh,
    identity,
    channel,
    prefs,
    skipApplicant: await userTalksHere(fresh, ticket.applicantId),
  });
};

const applyNotify = async ({ conversation, message, identity }) => {
  const { Conversation, Message, Preferences } = m();
  if (!["client", "form"].includes(message.origin)) return;
  // Модуль выключен — колокольчик вёл бы на страницу, которую никто не откроет (M1)
  const prefs = await Preferences.findOne({}).select("modules.messaging").lean();
  if (!prefs?.modules?.messaging?.isActive) return;
  const fresh = await Conversation.findById(conversation._id).lean();
  const startedWait =
    fresh.awaitingSince && new Date(fresh.awaitingSince).getTime() === new Date(message.sentAt).getTime();
  const current = await Message.findById(message._id).select("ticketId").lean();
  if (!startedWait || current?.ticketId || fresh.hidden) return;
  // Один звонок колокольчика на ожидание: несколько сообщений одного момента
  // (фотоальбом) и повтор доставки/гонка колокольчик не дублируют
  const claim = await Conversation.updateOne(
    { _id: fresh._id, awaitingSince: fresh.awaitingSince, waitNotifiedAt: { $ne: fresh.awaitingSince } },
    { $set: { waitNotifiedAt: fresh.awaitingSince } },
  );
  if (!claim.modifiedCount) return;
  const name = await displayNameFor(identity);
  const title =
    fresh.kind === "group"
      ? `Новое сообщение в группе «${fresh.title || rules.NETWORK_LABEL[fresh.network]}»`
      : `Новое сообщение${name ? ` от ${name}` : ""}`;
  await notifyWaiting({ conversation: fresh, message, title });
};

/** Эхо нашей отправки (шлюз пометил его jobId): дополняем своё сообщение. */
const confirmOwn = async (own, msg) => {
  const { Message, Comment } = m();
  const set = { status: rules.advanceStatus(own.status, "sent") };
  if (!own.externalId) set.externalId = msg.id;
  try {
    await Message.updateOne({ _id: own._id }, { $set: set });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    await Message.updateOne({ _id: own._id }, { $set: { status: set.status } });
  }
  if (own.commentId) {
    await Comment.updateOne({ _id: own.commentId }, { $set: { "channel.status": set.status, "channel.statusAt": new Date() } });
  }
  bump(own.ticketId ? [own.ticketId] : []);
};

const ingestMessage = async (event) => {
  const { Channel, Message } = m();
  const channel = await Channel.findById(event.channelId).lean();
  if (!channel || !channel.isActive) return { ok: false, retryable: false, error: "канал отключён или не найден" };
  const msg = event.message;

  if (msg.jobId) {
    const own = await Message.findOne({ jobId: msg.jobId }).lean();
    if (own) {
      await confirmOwn(own, msg);
      return { ok: true };
    }
  }
  if ((channel.settings?.ignoredChatIds || []).includes(event.chat.id)) return { ok: true, ignored: true };

  const identity = msg.sender ? await resolveIdentity(channel.type, msg.sender, deps()) : null;
  let counterpart = null;
  if (event.chat.kind === "direct") {
    if (event.chat.peer) {
      counterpart =
        msg.sender && event.chat.peer.id === msg.sender.id
          ? identity
          : await resolveIdentity(channel.type, event.chat.peer, deps());
    } else if (msg.direction === "in") {
      counterpart = identity;
    }
  }
  const conversation = await upsertConversation(channel, event.chat, counterpart);
  await addParticipant(conversation, identity);

  const message = await insertMessage({ channel, conversation, event, identity });
  const effects = message.effects || {};
  if (!effects.conversation) {
    await applyConversationEffects(conversation, message, identity);
    await markEffect(message._id, "conversation");
  }
  if (!effects.attach) {
    await applyAttach({ channel, conversation, message, identity });
    await markEffect(message._id, "attach");
  }
  if (!effects.notify) {
    await applyNotify({ conversation, message, identity });
    await markEffect(message._id, "notify");
  }
  bump();
  return { ok: true };
};

const ingestEdit = async (event) => {
  const { Message, Comment } = m();
  const message = await Message.findOne({
    channelId: event.channelId,
    externalChatId: event.chat.id,
    externalId: event.message.id,
  });
  if (!message) return { ok: true, ignored: true };
  if (message.text === event.message.text) return { ok: true };
  message.revisions = [...(message.revisions || []), { text: message.text, at: event.message.editedAt }];
  message.text = event.message.text;
  message.editedAt = event.message.editedAt;
  await message.save();
  if (message.commentId) {
    await Comment.updateOne(
      { _id: message.commentId },
      { $set: { content: rules.commentContent(message), "channel.editedAt": event.message.editedAt } },
    );
  }
  bump(message.ticketId ? [message.ticketId] : []);
  return { ok: true };
};

const ingestDelete = async (event) => {
  const { Message, Comment } = m();
  const filter = { channelId: event.channelId, externalId: { $in: event.messageIds }, deletedAt: null };
  if (event.chat) filter.externalChatId = event.chat.id;
  const messages = await Message.find(filter).select("_id commentId ticketId").lean();
  if (!messages.length) return { ok: true, ignored: true };
  const now = new Date();
  await Message.updateMany({ _id: { $in: messages.map((x) => x._id) } }, { $set: { deletedAt: now } });
  const commentIds = messages.map((x) => x.commentId).filter(Boolean);
  // Текст остаётся: удаление в мессенджере — пометка, а не стирание из заявки
  if (commentIds.length) await Comment.updateMany({ _id: { $in: commentIds } }, { $set: { "channel.deletedAt": now } });
  bump(messages.map((x) => x.ticketId).filter(Boolean));
  return { ok: true };
};

const ingestStatus = async (event) => {
  const { Message, Comment } = m();
  const filter = event.jobId
    ? { jobId: event.jobId }
    : { channelId: event.channelId, externalChatId: event.chat.id, externalId: { $in: event.messageIds } };
  const messages = await Message.find(filter);
  for (const message of messages) {
    const next = rules.advanceStatus(message.status, event.status);
    if (next === message.status) continue;
    message.status = next;
    if (next === "failed") message.error = event.error || "Не доставлено";
    await message.save();
    if (message.commentId) {
      // Клиенту — фиксированный текст на «failed», сырую ошибку статус-события
      // (event.error) в channel не пускаем; на остальных переходах чистим её —
      // $set: undefined ничего не чистит (Mongoose его вырезает), нужен $unset
      await Comment.updateOne(
        { _id: message.commentId },
        next === "failed"
          ? { $set: { "channel.status": next, "channel.statusAt": new Date(), "channel.error": "Не доставлено" } }
          : { $set: { "channel.status": next, "channel.statusAt": new Date() }, $unset: { "channel.error": 1 } },
      );
    }
  }
  bump(messages.map((x) => x.ticketId).filter(Boolean));
  return { ok: true };
};

const ingestChat = async (event) => {
  const { Channel, Conversation } = m();
  const channel = await Channel.findById(event.channelId).lean();
  if (!channel) return { ok: false, retryable: false, error: "канал не найден" };
  const conversation = await Conversation.findOne({ channelId: channel._id, externalChatId: event.chat.id }).lean();
  if (!conversation) return { ok: true, ignored: true };
  const set = {};
  if (event.chat.title) set.title = event.chat.title;
  if (event.chat.migratedToChatId) {
    set.externalChatId = event.chat.migratedToChatId;
  }
  if (Object.keys(set).length) {
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: set, ...(set.externalChatId ? { $addToSet: { externalAliases: conversation.externalChatId } } : {}) },
    );
  }
  for (const participant of (event.chat.participants || []).slice(0, 200)) {
    const identity = await resolveIdentity(channel.type, participant, deps());
    await addParticipant(conversation, identity);
  }
  bump();
  return { ok: true };
};

const ingestChannelState = async (event) => {
  const { Channel } = m();
  const set = { state: event.state, stateReason: event.reason || "", gatewaySeenAt: new Date() };
  if (event.account) set.account = event.account;
  set.login = event.login || { qr: null, expiresAt: null };
  const result = await Channel.updateOne({ _id: event.channelId }, { $set: set });
  return result.matchedCount ? { ok: true } : { ok: false, retryable: false, error: "канал не найден" };
};

const ingestEvent = async (event) => {
  switch (event.type) {
    case "message":
      return ingestMessage(event);
    case "message.edited":
      return ingestEdit(event);
    case "message.deleted":
      return ingestDelete(event);
    case "message.status":
      return ingestStatus(event);
    case "chat":
      return ingestChat(event);
    case "channel.state":
      return ingestChannelState(event);
    default:
      return { ok: false, retryable: false, error: "неизвестный тип события" };
  }
};

module.exports = { ingestEvent };
