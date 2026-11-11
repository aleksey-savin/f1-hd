const mongoose = require("mongoose");

const Conversation = require("@/models/conversation");
const Message = require("@/models/message");
const ChannelIdentity = require("@/models/channelIdentity");
const ConversationRead = require("@/models/conversationRead");
const Channel = require("@/models/channel");
const User = require("@/models/user");
const Company = require("@/models/company");
const { Ticket } = require("@/models/ticket");
const { AppError } = require("@/middleware/errorHandling");
const { canAccessTicket } = require("@/services/ticketAccess");
const { ticketListFilter } = require("@/services/ticketScope");
const { isBanned } = require("@/services/authBan");
const { bus } = require("@/services/pulse");
const storage = require("@/services/storage");
const { QUEUES, listFilter, canSeeConversation } = require("@/services/messaging/visibility");
const { conversationRow, messageRow, userName, candidateRow } = require("@/services/messaging/present");
const { NETWORKS, GATEWAY_NETWORKS, identityName } = require("@/services/messaging/rules");
const { addSystemLine } = require("@/services/messaging/conversationStore");
const { bindConversation, unbindConversation } = require("@/services/messaging/bindings");
const { sendFromInbox, retryMessage } = require("@/services/messaging/outbound");
const { ticketDraft, deliveryRoutes } = require("@/services/messaging/origin");
const { enqueueJob } = require("@/services/messaging/jobs");
const { activeBindings, linkedOpenTickets } = require("@/services/messaging/multi-ticket");
const { chooseReplyContext, loadReplyContext } = require("@/services/messaging/reply-context");
const { remapMessages } = require("@/services/messaging/remap");
const { personSearchClauses } = require("@/services/personSearch");
const { conversationSearchPipeline } = require("@/services/messaging/search");

/** «Диалоги» для сотрудников. Маршруты — routes/internal/conversation.js. */

const { readsAll, canReadInbox, canReadTicketMessages, canReplyToTicket, messageFilter, scopeAuth, scopedConversationStages } = require('@/services/messaging/access');
const prepareScope = async req => { req.auth = await scopeAuth(req.auth); };
const scopedRow = (conversation, ctx, auth) => {
  const row = conversationRow(conversation, ctx);
  if (!readsAll(auth)) {
    const ids = new Set((auth.messagingScope?.ticketIds || []).map(String));
    row.tickets = row.tickets.filter(ticket => ids.has(ticket.id));
    if (!ids.has(row.ticket?.id)) row.ticket = null;
    row.decision = null;
  }
  return row;
};
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isId = (id) => mongoose.isValidObjectId(id);
const idOf = (value) => (value ? String(value._id ?? value) : null);
const wrap = (error, fallback) =>
  error instanceof AppError ? error : new AppError(fallback, 500, true, error);
const byId = (list) => new Map(list.map((item) => [String(item._id), item]));
const me = (req) => User.findById(req.auth.userId).select("firstName lastName").lean();

/** Диалог по :id с проверкой видимости; чужой — 404, даже фактом не выдаём. */
const loadVisible = async (req) => {
  if (!isId(req.params.id)) throw new AppError("Диалог не найден", 404);
  await prepareScope(req);
  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation || !canSeeConversation(conversation, req.auth)) throw new AppError("Диалог не найден", 404);
  return conversation;
};

const loadOpenTicket = async (req, num) => {
  const ticketNum = Number(num);
  if (!Number.isInteger(ticketNum)) throw new AppError("Укажите номер заявки", 400);
  const ticket = await Ticket.findOne({ num: ticketNum })
    .select("_id num isClosed deletedAt applicantId responsibles createdBy company applicant")
    .lean();
  if (!ticket || ticket.deletedAt || !canAccessTicket(ticket, req.auth)) throw new AppError("Заявка не найдена", 404);
  if (ticket.isClosed) throw new AppError("Заявка закрыта — сначала верните её в работу", 409);
  return ticket;
};

/** Справочники строк списка: собеседники, люди, компании, непрочитанное. */
const rowContext = async (items, userId, auth) => {
  const identities = byId(
    await ChannelIdentity.find({ _id: { $in: items.map((c) => c.counterpartIdentityId).filter(Boolean) } }).lean(),
  );
  const userIds = [...[...identities.values()].map((i) => i.userId), ...items.map((c) => c.assigneeId)].filter(Boolean);
  const users = byId(await User.find({ _id: { $in: userIds } }).select("firstName lastName").lean());
  const companies = byId(await Company.find({ _id: { $in: items.map((c) => c.companyId).filter(Boolean) } }).select("alias").lean());
  const reads = new Map(
    (await ConversationRead.find({ userId, conversationId: { $in: items.map((c) => c._id) } }).lean()).map((r) => [
      String(r.conversationId),
      r.seenAt,
    ]),
  );
  // Счётчики — параллельно, не по одному: до 100 диалогов на странице списка,
  // а список перечитывается на каждый bump темы "conversations"
  const counts = await Promise.all(
    items.map((conversation) =>
      Message.countDocuments(
        {
          ...messageFilter(auth),
          conversationId: conversation._id,
          direction: "in",
          imported: { $ne: true },
          sentAt: { $gt: reads.get(String(conversation._id)) || new Date(0) },
        },
        { limit: 100 },
      ),
    ),
  );
  const unread = new Map();
  items.forEach((conversation, i) => {
    if (counts[i]) unread.set(String(conversation._id), counts[i]);
  });
  return { identities, users, companies, unread };
};

const queueCounts = async (auth) => {
  const counts = {};
  for (const queue of ["awaiting", "mine", "unbound", "all"]) {
    counts[queue] = readsAll(auth) ? await Conversation.countDocuments(listFilter(queue, auth))
      : (await Conversation.aggregate([...scopedConversationStages(auth), { $match: listFilter(queue, auth) }, { $count: 'count' }]))[0]?.count || 0;
  }
  return counts;
};

/** Счётчики очередей без списка — пилюля «Ждут ответа» у пункта меню. */
exports.counts = async (req, res, next) => {
  try {
    await prepareScope(req);
    res.status(200).json({ counts: await queueCounts(req.auth) });
  } catch (error) {
    next(wrap(error, "Не удалось посчитать диалоги"));
  }
};

exports.list = async (req, res, next) => {
  try {
    await prepareScope(req);
    const queue = String(req.query.queue || "all");
    if (!QUEUES.includes(queue)) return next(new AppError("Неизвестная очередь", 400));
    const extra = {};
    if (NETWORKS.includes(req.query.network)) extra.network = req.query.network;
    if (isId(req.query.company)) extra.companyId = oid(req.query.company);
    const q = String(req.query.q || "").trim().slice(0, 100);
    const filter = listFilter(queue, req.auth, extra);
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) filter.$and.push({ "lastMessage.at": { $lt: before } });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const page = q
      ? await Conversation.aggregate(conversationSearchPipeline({ filter, query: q, auth: req.auth, limit: limit + 1 }))
      : readsAll(req.auth) ? await Conversation.find(filter).sort({ "lastMessage.at": -1, _id: -1 }).limit(limit + 1).lean()
      : await Conversation.aggregate([...scopedConversationStages(req.auth), { $match: filter }, { $sort: { 'lastMessage.at': -1, _id: -1 } }, { $limit: limit + 1 }]);
    const items = page.slice(0, limit);
    const ctx = await rowContext(items, req.auth.userId, req.auth);
    res.status(200).json({
      items: items.map((conversation) => scopedRow(conversation, ctx, req.auth)),
      counts: await queueCounts(req.auth),
      nextBefore: page.length > limit ? items.at(-1)?.lastMessage?.at || null : null,
    });
  } catch (error) {
    next(wrap(error, "Не удалось загрузить диалоги"));
  }
};

/** Другие каналы того же человека — «Написать» в карточке контакта. */
const otherChannelsOf = async (userId, exceptId) => {
  const identities = await ChannelIdentity.find({ userId }).select("_id network username phone").lean();
  const conversations = await Conversation.find({
    counterpartIdentityId: { $in: identities.map((i) => i._id) },
    _id: { $ne: exceptId },
  })
    .select("_id counterpartIdentityId")
    .lean();
  return identities.map((identity) => ({
    network: identity.network,
    handle: identity.username ? `@${identity.username}` : identity.phone || "",
    conversationId: idOf(conversations.find((c) => String(c.counterpartIdentityId) === String(identity._id))),
  }));
};

exports.get = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const presented = readsAll(req.auth) ? conversation : (await Conversation.aggregate([
      { $match: { _id: conversation._id } }, ...scopedConversationStages(req.auth),
    ]))[0];
    const ctx = await rowContext([conversation], req.auth.userId, req.auth);
    const channel = await Channel.findById(conversation.channelId).select("type name state isActive provider").lean();
    const participantIds = [conversation.counterpartIdentityId, ...(conversation.participants || []).map((p) => p.identityId)].filter(Boolean);
    const identities = await ChannelIdentity.find({ _id: { $in: participantIds } }).lean();
    const people = byId(
      await User.find({ _id: { $in: identities.map((i) => i.userId).filter(Boolean) } })
        .select("firstName lastName position phone email company isEndUser")
        .lean(),
    );
    const person = (identity) => ({
      identityId: String(identity._id),
      name: userName(people.get(String(identity.userId))) || identityName(identity),
      username: identity.username || "",
      phone: identity.phone || "",
      userId: idOf(identity.userId),
      linkMethod: identity.linkMethod || null,
      isStaff: Boolean(identity.isStaff),
    });
    const counterpart = identities.find((i) => String(i._id) === String(conversation.counterpartIdentityId)) || null;
    const contactUser = counterpart?.userId ? people.get(String(counterpart.userId)) : null;
    const binding = conversation.binding || {};
    const historicalIds = readsAll(req.auth) ? [] : await Message.distinct('ticketId', { conversationId: conversation._id, ...messageFilter(req.auth) });
    const linkedTickets = readsAll(req.auth)
      ? await linkedOpenTickets(conversation)
      : await Ticket.find({ _id: { $in: [...historicalIds, ...activeBindings(conversation).map(link => link.ticketId)].filter(id => req.auth.messagingScope.ticketIds.some(allowed => String(allowed) === String(id))) }, deletedAt: null }).lean();
    const ticket = linkedTickets.find((ticket) => String(ticket._id) === String(binding.ticketId)) || linkedTickets[0] || null;
    const replyAllowed = ticket => activeBindings(conversation).some(link => String(link.ticketId) === String(ticket._id)) && canReplyToTicket(ticket, req.auth);
    const detail = (ticket) => ({
      id: String(ticket._id), num: ticket.num, title: ticket.title, state: ticket.state, deadline: ticket.deadline,
      responsibles: (ticket.responsibles || []).map((r) => userName(r)),
      canReply: req.auth.can({conversation:["reply"]}) && replyAllowed(ticket),
      boundAt: activeBindings(conversation).find((link) => String(link.ticketId) === String(ticket._id))?.boundAt || null,
    });
    const openTickets = readsAll(req.auth) && req.auth.can({conversation:["manage"]}) && conversation.companyId
      ? await Ticket.find({ $and: [{ "company._id": conversation.companyId, isClosed: false, _id: { $nin: linkedTickets.map((ticket) => ticket._id) } }, ticketListFilter(req.auth)] })
          .sort({ createdAt: -1 })
          .limit(5)
          .select("num title state deadline")
          .lean()
      : [];
    res.status(200).json({
      conversation: scopedRow(presented, ctx, req.auth),
      access: { all: readsAll(req.auth), reply: req.auth.can({conversation:['reply']}) && (readsAll(req.auth) || linkedTickets.some(replyAllowed)), manage: readsAll(req.auth) && req.auth.can({conversation:['manage']}), start: canReadInbox(req.auth) && req.auth.can({conversation:['reply','start']}) },
      channel: channel ? { id: String(channel._id), type: channel.type, name: channel.name, state: channel.state, isActive: channel.isActive, provider: channel.provider || "gateway" } : null,
      counterpart: counterpart ? person(counterpart) : null,
      participants: conversation.kind === "group" ? identities.map(person) : [],
      contact: contactUser
        ? {
            id: String(contactUser._id),
            name: userName(contactUser),
            position: contactUser.position || "",
            company: contactUser.company?.alias || "",
            phone: contactUser.phone || "",
            email: contactUser.email || "",
          }
        : null,
      otherChannels: readsAll(req.auth) && contactUser ? await otherChannelsOf(contactUser._id, conversation._id) : [],
      ticket: ticket ? detail(ticket) : null,
      tickets: linkedTickets.map(detail),
      replyContext: await loadReplyContext({ conversation, auth: req.auth }),
      openTickets: openTickets
        .map((t) => ({ id: String(t._id), num: t.num, title: t.title, state: t.state, deadline: t.deadline })),
    });
  } catch (error) {
    next(wrap(error, "Не удалось загрузить диалог"));
  }
};

/** Собеседники, авторы и цитируемые сообщения для рядов ленты. */
const messageRefs = async (rows, auth) => {
  const identities = byId(await ChannelIdentity.find({ _id: { $in: rows.map((m) => m.identityId).filter(Boolean) } }).lean());
  const replies = byId(await Message.find({ ...messageFilter(auth), deletedAt: null, _id: { $in: rows.map((m) => m.replyToId).filter(Boolean) } }).lean());
  const users = byId(
    await User.find({
      _id: {
        $in: [
          ...rows.map((m) => m.authorUserId),
          ...[...identities.values()].map((i) => i.userId),
          ...[...replies.values()].map((r) => r.authorUserId),
        ].filter(Boolean),
      },
    })
      .select("firstName lastName")
      .lean(),
  );
  const referenced = await Ticket.find({ _id: { $in: rows.map((m) => m.ticketId).filter(Boolean) } }).select("title responsibles messagingReaderIds createdBy applicantId applicant company").lean();
  const tickets = byId(referenced.filter((ticket) => canReadTicketMessages(ticket, auth)));
  return { identities, users, replies, tickets };
};

exports.messages = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

    if (req.query.changedSince) {
      const since = new Date(req.query.changedSince);
      if (Number.isNaN(since.getTime())) return next(new AppError("changedSince — дата", 400));
      const afterIdRaw = req.query.afterId;
      if (afterIdRaw && !isId(afterIdRaw)) return next(new AppError("afterId — некорректный id", 400));
      // Без afterId: хотя бы раз (клиент сольёт повтор по id) — так страница на
      // границе окна не теряет строки. С afterId: строго после этой пары —
      // одинаковый updatedAt у нескольких строк не потерять и не повторить.
      const scope = messageFilter(req.auth);
      const filter = {
        ...(!readsAll(req.auth) ? { $and: [{ $or: [scope, { previousTicketIds: scope.ticketId }] }] } : {}),
        conversationId: conversation._id,
        ...(afterIdRaw
          ? { $or: [{ updatedAt: { $gt: since } }, { updatedAt: since, _id: { $gt: oid(afterIdRaw) } }] }
          : { updatedAt: { $gte: since } }),
      };
      // Метка ДО запроса: сообщение, записанное между чтением базы и моментом
      // ответа, не должно пропасть из следующего опроса — попадёт в него ещё
      // раз, а не потеряется. Используется только когда страница неполная —
      // иначе некуда «отступать», и опрос продолжает afterId последней строки.
      const capturedAt = new Date();
      // Порядок — по изменению (updatedAt, _id), не по seq: правку и смену
      // статуса сортируем по времени правки. Ленту клиент показывает по seq.
      const rows = await Message.find(filter).sort({ updatedAt: 1, _id: 1 }).limit(limit).lean();
      const visible = readsAll(req.auth) ? rows : rows.filter(message => req.auth.messagingScope.ticketIds.some(id => String(id) === String(message.ticketId)));
      const removedIds = rows.filter(message => !visible.includes(message)).map(message => String(message._id));
      const refs = await messageRefs(visible, req.auth);
      const items = visible.map((m) => messageRow(m, refs));
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        return res.status(200).json({ items, removedIds, serverTime: last.updatedAt, afterId: String(last._id), hasMore: true });
      }
      return res.status(200).json({ items, removedIds, serverTime: capturedAt, hasMore: false });
    }

    const filter = { ...messageFilter(req.auth), conversationId: conversation._id };
    if (req.query.before) {
      const before = new Date(req.query.before);
      const seq = Number(req.query.beforeSeq);
      if (Number.isNaN(before.getTime()) || !Number.isFinite(seq)) return next(new AppError("before и beforeSeq обязательны вместе", 400));
      filter.$or = [{ sentAt: { $lt: before } }, { sentAt: before, seq: { $lt: seq } }];
    }
    // Метка ДО запроса, не после: сообщение, записанное между чтением базы и
    // моментом ответа, не должно пропасть из следующего опроса по changedSince —
    // повтор на следующем опросе не страшен (клиент сольёт по id), пропуск страшен
    const serverTime = new Date();
    const rows = await Message.find(filter).sort({ sentAt: -1, seq: -1 }).limit(limit).lean();
    rows.reverse();
    const refs = await messageRefs(rows, req.auth);
    res.status(200).json({ items: rows.map((m) => messageRow(m, refs)), serverTime });
  } catch (error) {
    next(wrap(error, "Не удалось загрузить сообщения"));
  }
};

exports.ticketDraft = async (req, res, next) => {
  try {
    res.status(200).json(
      await ticketDraft({ auth: req.auth, conversationId: req.params.id, messageIds: String(req.query.messages || "") }),
    );
  } catch (error) {
    next(wrap(error, "Не удалось собрать заявку из диалога"));
  }
};

exports.seen = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const previous = await ConversationRead.findOneAndUpdate(
      { userId: req.auth.userId, conversationId: conversation._id },
      { $set: { seenAt: new Date() } },
      { upsert: true, new: false },
    ).lean();
    // «Прочитано» у клиента — только если с прошлого открытия пришло новое
    const channel = await Channel.findById(conversation.channelId).select("type isActive settings provider").lean();
    if (readsAll(req.auth) && req.auth.can({conversation:['reply']}) && channel?.isActive && channel.provider !== 'wazzup' && GATEWAY_NETWORKS.includes(channel.type) && channel.settings?.markReadOnOpen !== false) {
      const latest = await Message.findOne({
        conversationId: conversation._id,
        direction: "in",
        externalId: { $type: "string" },
        ...(previous?.seenAt ? { createdAt: { $gt: previous.seenAt } } : {}),
      })
        .sort({ sentAt: -1 })
        .select("externalId")
        .lean();
      if (latest) {
        await enqueueJob({
          channelId: channel._id,
          network: channel.type,
          provider: require("@/services/messaging/transport").providerOf(channel),
          type: "markRead",
          conversationId: conversation._id,
          payload: { chatId: conversation.externalChatId, upToExternalId: latest.externalId },
        });
      }
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось отметить прочитанным"));
  }
};

exports.send = async (req, res, next) => {
  try {
    await loadVisible(req);
    const message = await sendFromInbox({
      conversationId: req.params.id,
      text: req.body?.text,
      stickerId: req.body?.stickerId,
      files: req.files || [],
      auth: req.auth,
      ticketNum: req.body?.ticketNum,
      replyToId: req.body?.replyToId,
      withoutTicket: req.body?.withoutTicket === true || req.body?.withoutTicket === "true",
    });
    res.status(201).json({ message: messageRow(message, {}) });
  } catch (error) {
    // Отказ до создания сообщения — файлы формы никому не нужны
    if (error instanceof AppError && error.statusCode < 500) {
      for (const file of req.files || []) storage.deleteObject(file.key).catch(() => {});
    }
    next(wrap(error, "Не удалось отправить сообщение"));
  }
};

/** Новый диалог: адрес и права повторно проверяет общий сервис очереди. */
exports.startRecipients = async (req, res, next) => {
  try {
    res.status(200).json(await require("@/services/messaging/start").startRecipients({ q: req.query.q, auth: req.auth }));
  } catch (error) { next(wrap(error, "Не удалось найти получателей")); }
};
exports.startRoutes = async (req, res, next) => {
  try {
    res.status(200).json(await require("@/services/messaging/start").startRoutes({ userId: req.query.userId, phone: req.query.phone, auth: req.auth }));
  } catch (error) { next(wrap(error, "Не удалось загрузить каналы отправки")); }
};
exports.start = async (req, res, next) => {
  try {
    const { userId, phone, routeId, text, clientRequestId } = req.body || {};
    const result = await require("@/services/messaging/start").startConversation({ userId, phone, routeId, text, clientRequestId, files: req.files || [], auth: req.auth });
    const { duplicate: _duplicate, cleanupKeys = [], ...receipt } = result;
    for (const key of cleanupKeys) storage.deleteObject(key).catch(() => {});
    res.status(202).json(receipt);
  } catch (error) {
    if (error instanceof AppError && error.statusCode < 500) {
      const keys = await require("@/services/messaging/start").rejectedUploadKeys({ clientRequestId: req.body?.clientRequestId, files: req.files || [], auth: req.auth });
      for (const key of keys) storage.deleteObject(key).catch(() => {});
    }
    next(wrap(error, "Не удалось поставить сообщение в очередь"));
  }
};
exports.outgoingStatus = async (req, res, next) => {
  try {
    res.status(200).json(await require("@/services/messaging/start").outgoingStatus({ messageId: req.params.id, auth: req.auth }));
  } catch (error) { next(wrap(error, "Не удалось проверить отправку")); }
};
exports.startRequestStatus = async (req, res, next) => {
  try {
    res.status(200).json(await require("@/services/messaging/start").startRequestStatus({ clientRequestId: req.params.requestId, auth: req.auth }));
  } catch (error) { next(wrap(error, "Не удалось проверить отправку")); }
};

exports.handled = async (req, res, next) => {
  try {
    if (!readsAll(req.auth) || !req.auth.can({conversation:["manage"]})) throw new AppError("Недостаточно прав для обработки всего диалога", 403);
    const conversation = await loadVisible(req);
    const result = await Conversation.updateOne(
      { _id: conversation._id, awaitingSince: { $ne: null } },
      { $set: { awaitingSince: null, handled: { at: new Date(), by: req.auth.userId, how: "noReply" } } },
    );
    if (result.modifiedCount) await addSystemLine(conversation, { kind: "handled", by: await me(req) });
    bus.bump({ topics: ["conversations"] });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось отметить диалог"));
  }
};

exports.retry = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return next(new AppError("Сообщение не найдено", 404));
    const message = await retryMessage({ messageId: req.params.id, auth: req.auth });
    res.status(200).json({ message: messageRow(message, {}) });
  } catch (error) {
    next(wrap(error, "Не удалось повторить отправку"));
  }
};

exports.assign = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const userId = req.body?.userId ?? null;
    let assignee = null;
    if (userId !== null) {
      if (!isId(userId)) return next(new AppError("Некорректный пользователь", 400));
      // Срок отключения смотрит isBanned, а не сырой banned (у отключения есть срок)
      const candidate = await User.findOne({ _id: userId, isEndUser: false, isServiceAccount: { $ne: true } })
        .select("firstName lastName deletedAt banned banExpires")
        .lean();
      if (!candidate || isBanned(candidate)) return next(new AppError("Назначить можно только сотрудника", 400));
      assignee = candidate;
    }
    await Conversation.updateOne({ _id: conversation._id }, { $set: { assigneeId: assignee?._id || null } });
    await addSystemLine(conversation, { kind: "assigned", by: await me(req), targetName: assignee ? userName(assignee) : "" });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось назначить ответственного"));
  }
};

exports.bind = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    if (conversation.kind !== "direct") {
      return next(new AppError("Групповой чат к заявке не привязывается — добавьте в заявку нужные сообщения", 409));
    }
    const ticket = await loadOpenTicket(req, req.body?.ticketNum);
    await bindConversation({ conversation, ticket, by: await me(req) });
    if (req.auth.can({ conversation: ["reply"] })) {
      const fresh = await Conversation.findById(conversation._id).lean();
      await chooseReplyContext({ conversation: fresh, auth: req.auth, ticketNum: ticket.num });
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось привязать диалог"));
  }
};

exports.context = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    if (!Object.hasOwn(req.body || {}, "ticketNum")) throw new AppError("Выберите заявку или «Без заявки»", 400);
    const replyContext = await chooseReplyContext({ conversation, auth: req.auth, ticketNum: req.body.ticketNum });
    res.status(200).json({ replyContext });
  } catch (error) { next(wrap(error, "Не удалось выбрать контекст ответа")); }
};

exports.unbind = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    res.status(200).json({ ok: await unbindConversation({ conversation, by: await me(req), ticketNum: req.body?.ticketNum, auth: req.auth }) });
  } catch (error) {
    next(wrap(error, "Не удалось отвязать диалог"));
  }
};

exports.attach = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const ticket = req.body?.ticketNum === null ? null : await loadOpenTicket(req, req.body?.ticketNum);
    const ids = (Array.isArray(req.body?.messageIds) ? req.body.messageIds : []).filter(isId).slice(0, 200);
    if (!ids.length) return next(new AppError("Выберите сообщения", 400));
    const messages = await Message.find({ _id: { $in: ids }, conversationId: conversation._id, direction: { $ne: "system" } })
      .sort({ sentAt: 1, seq: 1 })
      .lean();
    if (messages.length !== new Set(ids.map(String)).size) throw new AppError("Сообщения не из этого диалога", 400);
    const sourceIds = [...new Set(messages.map((message) => message.ticketId).filter(Boolean).map(String))];
    const sources = sourceIds.length ? await Ticket.find({ _id: { $in: sourceIds } }).lean() : [];
    if (sources.some((source) => !canAccessTicket(source, req.auth))) throw new AppError("Заявка не найдена", 404);
    const actor = await me(req);
    const count = await remapMessages({ conversation, messages, ticket, auth: req.auth, by: actor });
    if (count) await addSystemLine(conversation, { kind: ticket ? "attached" : "freed", ticketNum: ticket?.num, by: actor, count });
    bus.bump({ topics: ["conversations"], ticketIds: [...sourceIds, ...(ticket ? [ticket._id] : [])] });
    res.status(200).json({ attached: count });
  } catch (error) {
    next(wrap(error, "Не удалось добавить сообщения в заявку"));
  }
};

exports.decision = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    // «Вернуть в работу» — действие заявки (хук возврата сам восстановит
    // привязку), «Новая заявка» — форма заявки; здесь только «Без заявки»
    if (req.body?.action !== "none") return next(new AppError("Ожидается action: none", 400));
    if (Array.isArray(conversation.ticketBindings) && conversation.decision?.ticketId) {
      await Conversation.updateOne({ _id: conversation._id }, { $set: { "ticketBindings.$[link].endReason": "manual" } },
        { arrayFilters: [{ "link.ticketId": conversation.decision.ticketId, "link.endReason": "closed" }] });
    }
    await Conversation.updateOne({ _id: conversation._id }, { $set: { decision: { ticketId: null, ticketNum: null, at: null } } });
    // «Без заявки» обязано закрыть вопрос НАВСЕГДА для этого закрытия: не
    // сменить endReason на "manual" — rules.decideAttach снова спросит
    // «По заявке X?» на следующее сообщение клиента (окно 30 дней после
    // "closed" не смотрит на пустой decision.ticketId)
    await Conversation.updateOne(
      { _id: conversation._id, "binding.endedAt": { $ne: null } },
      { $set: { "binding.endReason": "manual" } },
    );
    bus.bump({ topics: ["conversations"] });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось ответить на вопрос о заявке"));
  }
};

exports.hide = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    await Conversation.updateOne({ _id: conversation._id }, { $set: { hidden: req.body?.hidden !== false } });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось скрыть диалог"));
  }
};

exports.update = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    if (!Object.hasOwn(req.body || {}, "companyId")) return next(new AppError("Нечего менять", 400));
    let companyId = null;
    if (req.body.companyId !== null) {
      if (!isId(req.body.companyId) || !(await Company.exists({ _id: req.body.companyId }))) {
        return next(new AppError("Компания не найдена", 400));
      }
      companyId = oid(req.body.companyId);
    }
    await Conversation.updateOne({ _id: conversation._id }, { $set: { companyId } });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось изменить диалог"));
  }
};

/** Собеседник, чьи диалоги человеку видны; иначе 404. */
const loadVisibleIdentity = async (req) => {
  if (!isId(req.params.id)) throw new AppError("Собеседник не найден", 404);
  const identity = await ChannelIdentity.findById(req.params.id).lean();
  if (!identity) throw new AppError("Собеседник не найден", 404);
  const conversations = await Conversation.find({
    $or: [{ counterpartIdentityId: identity._id }, { "participants.identityId": identity._id }],
  }).lean();
  if (!conversations.some((c) => canSeeConversation(c, req.auth))) throw new AppError("Собеседник не найден", 404);
  return identity;
};

exports.linkIdentity = async (req, res, next) => {
  try {
    const identity = await loadVisibleIdentity(req);
    if (!isId(req.body?.userId)) return next(new AppError("Укажите пользователя", 400));
    const user = await User.findOne({ _id: req.body.userId, deletedAt: null, isServiceAccount: { $ne: true } }).select("_id company isEndUser").lean();
    if (!user) return next(new AppError("Пользователь не найден", 404));
    const companyId = user.company?._id || null;
    // Ручная связь — твёрдое основание (I6): перебивает компанию личности и, для
    // direct-диалога этого собеседника, компанию диалога — даже если там уже
    // что-то стояло (например, по заявке). Групповые диалоги не трогаем.
    await ChannelIdentity.updateOne(
      { _id: identity._id },
      { $set: { userId: user._id, linkMethod: "manual", isStaff: user.isEndUser === false, companyId } },
    );
    await Conversation.updateMany({ counterpartIdentityId: identity._id, kind: "direct" }, { $set: { companyId } });
    bus.bump({ topics: ["conversations"] });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось связать собеседника"));
  }
};

// Поля поиска «Это он» — те же, что у адресной книги (controllers/user.js)
const CANDIDATE_SEARCH_FIELDS = ["firstName", "lastName", "email", "phone", "position", "company.alias"];

/**
 * Кандидаты для ручной связи собеседника («Кто это?» → «Это он»): каждое слово
 * запроса должно найтись хоть в одном поле, номер — по цифрам; клиенты первыми. Наружу — имя,
 * должность и компания (present.candidateRow), контактов нет.
 */
exports.candidates = async (req, res, next) => {
  try {
    await loadVisibleIdentity(req);
    const and = personSearchClauses(req.query.q, CANDIDATE_SEARCH_FIELDS, 4);
    if (!and.length) return res.status(200).json({ items: [] });
    const found = await User.find({ $and: [{ isServiceAccount: { $ne: true } }, ...and] })
      .select("firstName lastName position company deletedAt banned banExpires")
      .sort({ isEndUser: -1, lastName: 1, firstName: 1 })
      .limit(16)
      .lean();
    // Срок отключения смотрит isBanned, а не сырой banned (у отключения есть срок)
    const items = found.filter((user) => !isBanned(user)).slice(0, 8).map(candidateRow);
    res.status(200).json({ items });
  } catch (error) {
    next(wrap(error, "Не удалось найти пользователей"));
  }
};

exports.unlinkIdentity = async (req, res, next) => {
  try {
    const identity = await loadVisibleIdentity(req);
    await ChannelIdentity.updateOne({ _id: identity._id }, { $set: { userId: null, linkMethod: null, isStaff: false } });
    bus.bump({ topics: ["conversations"] });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось отвязать собеседника"));
  }
};

exports.deliveryRoutes = async (req, res, next) => {
  try {
    const result = await deliveryRoutes(req.ticket);
    const applicantId = req.ticket.applicantId?._id || req.ticket.applicantId || req.ticket.applicant?._id;
    const applicant = applicantId
      ? await User.findById(applicantId).select("firstName lastName").lean()
      : null;
    res.status(200).json({ ...result, canSend: canReplyToTicket(req.ticket, req.auth) && (req.auth.can({ticket:["sendMessage"]}) || (canReadInbox(req.auth) && req.auth.can({conversation:["reply"]}))), applicantName: userName(applicant) });
  } catch (error) {
    next(wrap(error, "Не удалось подобрать каналы ответа"));
  }
};
