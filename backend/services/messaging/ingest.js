/**
 * Единый вход событий каналов: шлюз (Telegram, WhatsApp), вебхук MAX, форма
 * сайта. Событие уже проверено (events.js). Каждый шаг повторяем: повтор
 * доставки находит сообщение по уникальному индексу и доделывает только шаги
 * без отметки в `effects` — транзакций у standalone-MongoDB нет.
 */
const rules = require("./rules");
const { resolveIdentity, modelDeps } = require("./identity");
const { nextSeq, addSystemLine, userTalksHere, displayNameFor } = require("./conversationStore");
const { withMessageLease } = require("./message-lease");
const { mirrorToTicket } = require("./mirror");
const { notifyWaiting } = require("./notify");
const { shouldAlertChannelState, alertChannelState } = require("./channelAlert");

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
    ? await require("./incoming-context").findQuotedSource({ channelId: channel._id, externalChatId: event.chat.id, externalId: msg.replyToId })
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
      authorName: origin === "device" ? deviceName(channel) : !identity && event.chat.kind === "group" ? "Неизвестный участник" : "",
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
  const authorName = message.direction === "in" ? await displayNameFor(identity) || message.authorName : message.authorName;
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

const applyAttach = async ({ channel, conversation, message, identity }) => {
  const { Conversation, Message, Ticket, Preferences } = m();
  const fresh = await Conversation.findById(conversation._id).lean();
  const binding = fresh.binding || {};
  const boundTicket =
    binding.ticketId && !binding.endedAt
      ? await Ticket.findById(binding.ticketId).select("_id num isClosed applicantId").lean()
      : null;
  const incomingContext = await require("./incoming-context").incomingRoutingContext({ conversation: fresh, message });
  const replyToTicket = incomingContext.replyToMessage?.ticketId
    ? await Ticket.findById(incomingContext.replyToMessage.ticketId).select("_id num isClosed applicantId deletedAt").lean() : null;
  const linkedTickets = Array.isArray(fresh.ticketBindings) ? await require("./multi-ticket").linkedOpenTickets(fresh) : undefined;
  if (linkedTickets) {
    let endedAny = false;
    for (const link of require("./multi-ticket").activeBindings(fresh)) {
      if (linkedTickets.some((ticket) => String(ticket._id) === String(link.ticketId))) continue;
      const removed = await Ticket.findById(link.ticketId).select("isClosed").lean();
      await require("./bindings").endBindingsForTicket(link.ticketId, removed ? "closed" : "deleted");
      endedAny = true;
    }
    if (endedAny) Object.assign(fresh, await Conversation.findById(fresh._id).lean());
  }
  let verdict = rules.decideAttach({ conversation: fresh, message, boundTicket, replyToTicket, linkedTickets, ...incomingContext });
  if (!verdict.mode && !verdict.suggestTicketId && linkedTickets?.length > 1 && message.direction === "in" && message.origin === "client" && !message.imported) {
    const recentMessages = await Message.find({ conversationId: fresh._id, ticketId: { $in: linkedTickets.map((ticket) => ticket._id) }, sentAt: { $lte: message.sentAt } })
      .sort({ sentAt: -1 }).limit(8).lean();
    const classified = await require("./ticketClassifier").classifyIncomingTicket({ conversation: fresh, message, linkedTickets, recentMessages });
    const target = classified && linkedTickets.find((ticket) => String(ticket._id) === String(classified.ticketId));
    if (target) verdict = { mode: "ai", ticketId: target._id, ticketNum: target.num };
  }

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
  if (verdict.mode === "free") {
    await require("./incoming-context").persistFreeMapping(message._id, verdict.discussionUserId);
    return;
  }
  // Classification can take several seconds: membership and ticket status must
  // still be valid when its result reaches the persistence boundary.
  const targetTicket = await Ticket.findById(verdict.ticketId).select("_id num applicantId isClosed deletedAt").lean();
  if (!targetTicket || targetTicket.isClosed || targetTicket.deletedAt) return;
  if (fresh.kind === "direct") {
    const latest = await Conversation.findById(fresh._id).lean();
    if (!latest || !require("./multi-ticket").activeBindings(latest).some((link) => String(link.ticketId) === String(verdict.ticketId))) return;
  }

  const claimed = await Message.findOneAndUpdate(
    { _id: message._id, ticketId: null, attachMode: null, mappingIntent: { $exists: false } },
    { $set: { ticketId: verdict.ticketId, ticketNum: verdict.ticketNum, attachMode: verdict.mode } },
    { returnDocument: "after" },
  ).lean();
  let target = claimed;
  if (!target) {
    target = await Message.findById(message._id).lean();
    // Заявлено за другую заявку конкурентно (например, ручной привязкой) —
    // зеркалить в verdict.ticketId уже нельзя, сообщение не про неё
    if (!target || String(target.ticketId) !== String(verdict.ticketId) || target.attachMode === "free") return;
  }
  const ticket = targetTicket;
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
  const current = await Message.findById(message._id).select("ticketId attachMode discussionUserId").lean();
  if (!startedWait || current?.ticketId || fresh.hidden) return;
  // Several messages in one album can share the instant that started waiting.
  // Reserve a single source so a concurrent sibling cannot checkpoint a
  // different audience while the first source still has pending recipients.
  const winner = await Conversation.updateOne({
    _id: fresh._id, awaitingSince: fresh.awaitingSince, hidden: { $ne: true },
    waitNotifiedAt: { $ne: fresh.awaitingSince },
    $or: [{ "waitNotification.since": { $ne: fresh.awaitingSince } }, { "waitNotification.messageId": message._id }],
  }, { $set: { waitNotification: { since: fresh.awaitingSince, messageId: message._id } } });
  if (!winner.matchedCount) return;
  const name = await displayNameFor(identity);
  const title =
    fresh.kind === "group"
      ? `Новое сообщение в группе «${fresh.title || rules.NETWORK_LABEL[fresh.network]}»`
      : `Новое сообщение${name ? ` от ${name}` : ""}`;
  await notifyWaiting({ conversation: fresh, message: { ...message, ...current }, title });
  // Each recipient's bell row is idempotent; checkpoint only after all writes.
  await Conversation.updateOne(
    { _id: fresh._id, awaitingSince: fresh.awaitingSince },
    { $set: { waitNotifiedAt: fresh.awaitingSince }, $unset: { waitNotification: 1 } },
  );
};

// Both echo and receipt events can race with an operator retry or a newer
// receipt. Pin the attempt and the exact status used to compute the transition.
const recordDelivery = async (message, status, { externalId, error } = {}) => {
  const { Message } = m();
  const owner = { _id: message._id, channelId: message.channelId, jobId: message.jobId ?? null };
  const next = rules.advanceStatus(message.status, status);
  const set = {};
  if (next !== message.status) {
    set.status = next;
    set.error = next === "failed" ? error || "Не доставлено" : "";
  }
  if (externalId && !message.externalId) set.externalId = externalId;
  if (Object.keys(set).length) {
    const filter = { ...owner, status: message.status, externalId: message.externalId ?? null };
    let result;
    try {
      result = await Message.updateOne(filter, { $set: set });
    } catch (failure) {
      if (failure?.code !== 11000 || !set.externalId) throw failure;
      // Another message already owns this provider ID. Preserve a legitimate
      // status transition even when the echo cannot supply its external ID.
      delete set.externalId;
      if (Object.keys(set).length) result = await Message.updateOne(filter, { $set: set });
    }
    if (result && !result.matchedCount) throw new Error("Message changed during delivery update");
  }
  // Replay must also repair a failed comment write when the message itself
  // already has the event's status.
  if (message.commentId) await require("./send-outcome").projectCommentStatus(message, owner);
};

const ingestMessage = async (event) => {
  const { Channel, Message } = m();
  const channel = await Channel.findById(event.channelId).lean();
  if (!channel || !channel.isActive) return { ok: false, retryable: false, error: "канал отключён или не найден" };
  const msg = event.message;

  if (msg.direction === "out" && msg.origin === "hd") {
    const own = await Message.findOne({ channelId: channel._id, jobId: msg.jobId, origin: "hd", direction: "out" }).lean();
    if (!own) return { ok: true, ignored: true };
    await recordDelivery(own, "sent", { externalId: msg.id });
    bump(own.ticketId ? [own.ticketId] : []);
    return { ok: true };
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
  const row = await Message.findOne({
    channelId: event.channelId,
    externalChatId: event.chat.id,
    externalId: event.message.id,
  }).select("_id").lean();
  if (!row) return { ok: true, ignored: true };
  const { text, editedAt } = event.message;
  await withMessageLease(row._id, async (message, lease) => {
    if (message.text !== text && (!message.editedAt || +editedAt > +message.editedAt)) {
      await lease.assertOwned();
      await Message.updateOne({ _id: message._id, "mappingLock.token": message.mappingLock.token }, {
        $push: { revisions: { text: message.text, at: editedAt } },
        $set: { text, editedAt },
      });
      Object.assign(message, { text, editedAt });
    }
    if (!message.editedAt) return;
    // Replay repairs the mirror from the current revision, including after a
    // crash between writes or when an older event arrives after a newer edit.
    await lease.assertOwned();
    await Comment.updateOne(
      message.commentId ? { _id: message.commentId } : { "channel.messageId": message._id },
      { $set: { content: rules.commentContent(message), "channel.editedAt": message.editedAt } },
    );
    bump(message.ticketId ? [message.ticketId] : []);
  });
  return { ok: true };
};

const ingestDelete = async (event) => {
  const { Message, Comment } = m();
  const filter = { channelId: event.channelId, externalId: { $in: event.messageIds } };
  if (event.chat) filter.externalChatId = event.chat.id;
  const rows = await Message.find(filter).select("_id ticketId").lean();
  if (!rows.length) return { ok: true, ignored: true };
  const at = event.at || new Date();
  for (const row of rows) {
    await withMessageLease(row._id, async (message, lease) => {
      if (!message.deletedAt) {
        await lease.assertOwned();
        await Message.updateOne({ _id: row._id, "mappingLock.token": message.mappingLock.token }, { $set: { deletedAt: at } });
      }
      await lease.assertOwned();
      await Comment.updateOne(
        message.commentId ? { _id: message.commentId } : { "channel.messageId": message._id },
        { $set: { "channel.deletedAt": message.deletedAt || at } },
      );
    });
  }
  bump(rows.map((row) => row.ticketId).filter(Boolean));
  return { ok: true };
};

const ingestStatus = async (event) => {
  const { Message } = m();
  const filter = event.jobId
    ? { channelId: event.channelId, jobId: event.jobId, direction: "out", origin: "hd" }
    : { channelId: event.channelId, externalChatId: event.chat.id, externalId: { $in: event.messageIds } };
  const messages = await Message.find(filter).lean();
  for (const message of messages) await recordDelivery(message, event.status, { error: event.error });
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
  for (const participant of event.chat.participants || []) {
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
  // Колокольчик администраторам — один на переход (channelAlert.js): запись
  // условна по прежнему состоянию, поэтому повтор события, повторная доставка
  // и гонка двух доставок второй раз его не будят
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await Channel.findById(event.channelId).select("name state isActive errorAlertedAt").lean();
    if (!before) return { ok: false, retryable: false, error: "канал не найден" };
    const now = new Date();
    const alert = shouldAlertChannelState({
      previous: before.state,
      next: event.state,
      active: before.isActive,
      errorAlertedAt: before.errorAlertedAt,
      now,
    });
    const claim = alert && event.state === "error" ? { errorAlertedAt: now } : {};
    const result = await Channel.updateOne({ _id: before._id, state: before.state }, { $set: { ...set, ...claim } });
    // Состояние успели сменить параллельно — перечитать и решить заново
    if (!result.matchedCount) continue;
    if (alert) await alertChannelState({ channel: before, state: event.state, reason: event.reason || "" });
    return { ok: true };
  }
  // Дважды проиграли гонку: состояние всё равно пишем, а колокольчик за этот
  // переход разослала доставка, которая выиграла
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

module.exports = { ingestEvent, upsertConversation };
