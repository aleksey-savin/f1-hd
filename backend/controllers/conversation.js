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
const { ticketListFilter, ticketInScope } = require("@/services/ticketScope");
const { isBanned } = require("@/services/authBan");
const { bus } = require("@/services/pulse");
const storage = require("@/services/storage");
const { QUEUES, listFilter, canSeeConversation } = require("@/services/messaging/visibility");
const { conversationRow, messageRow, userName, candidateRow } = require("@/services/messaging/present");
const { NETWORKS, GATEWAY_NETWORKS, identityName } = require("@/services/messaging/rules");
const { addSystemLine } = require("@/services/messaging/conversationStore");
const { bindConversation, unbindConversation, attachMessages } = require("@/services/messaging/bindings");
const { sendFromInbox, retryMessage } = require("@/services/messaging/outbound");
const { ticketDraft, deliveryRoutes } = require("@/services/messaging/origin");
const { enqueueJob } = require("@/services/messaging/jobs");
const { personSearchClauses } = require("@/services/personSearch");
const { phoneSearchDigits, phoneDigitsPattern } = require("@/services/phone");

/** «Диалоги» для сотрудников. Маршруты — routes/internal/conversation.js. */

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isId = (id) => mongoose.isValidObjectId(id);
const idOf = (value) => (value ? String(value._id ?? value) : null);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wrap = (error, fallback) =>
  error instanceof AppError ? error : new AppError(fallback, 500, true, error);
const byId = (list) => new Map(list.map((item) => [String(item._id), item]));
const me = (req) => User.findById(req.auth.userId).select("firstName lastName").lean();

/** Диалог по :id с проверкой видимости; чужой — 404, даже фактом не выдаём. */
const loadVisible = async (req) => {
  if (!isId(req.params.id)) throw new AppError("Диалог не найден", 404);
  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation || !canSeeConversation(conversation, req.auth)) throw new AppError("Диалог не найден", 404);
  return conversation;
};

const loadOpenTicket = async (req, num) => {
  const ticketNum = Number(num);
  if (!Number.isInteger(ticketNum)) throw new AppError("Укажите номер заявки", 400);
  const ticket = await Ticket.findOne({ num: ticketNum })
    .select("_id num isClosed applicantId responsibles createdBy company applicant")
    .lean();
  if (!ticket || !canAccessTicket(ticket, req.auth)) throw new AppError("Заявка не найдена", 404);
  if (ticket.isClosed) throw new AppError("Заявка закрыта — сначала верните её в работу", 409);
  return ticket;
};

/** Справочники строк списка: собеседники, люди, компании, непрочитанное. */
const rowContext = async (items, userId) => {
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
    counts[queue] = await Conversation.countDocuments(listFilter(queue, auth));
  }
  return counts;
};

/** Счётчики очередей без списка — пилюля «Ждут ответа» у пункта меню. */
exports.counts = async (req, res, next) => {
  try {
    res.status(200).json({ counts: await queueCounts(req.auth) });
  } catch (error) {
    next(wrap(error, "Не удалось посчитать диалоги"));
  }
};

exports.list = async (req, res, next) => {
  try {
    const queue = String(req.query.queue || "all");
    if (!QUEUES.includes(queue)) return next(new AppError("Неизвестная очередь", 400));
    const extra = {};
    if (NETWORKS.includes(req.query.network)) extra.network = req.query.network;
    if (isId(req.query.company)) extra.companyId = oid(req.query.company);
    const q = String(req.query.q || "").trim().slice(0, 100);
    if (q) {
      const pattern = new RegExp(escapeRegExp(q), "i");
      extra.$or = [{ title: pattern }, { "lastMessage.preview": pattern }, { "lastMessage.authorName": pattern }];
      // Номер — ещё и по цифрам через разделители, в заголовке и авторе (превью — длинный текст, \D* склеил бы соседние номера)
      for (const digits of phoneSearchDigits(q)) {
        const byDigits = phoneDigitsPattern(digits);
        extra.$or.push({ title: byDigits }, { "lastMessage.authorName": byDigits });
      }
    }
    const filter = listFilter(queue, req.auth, extra);
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) filter.$and.push({ "lastMessage.at": { $lt: before } });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const page = await Conversation.find(filter).sort({ "lastMessage.at": -1, _id: -1 }).limit(limit + 1).lean();
    const items = page.slice(0, limit);
    const ctx = await rowContext(items, req.auth.userId);
    res.status(200).json({
      items: items.map((conversation) => conversationRow(conversation, ctx)),
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
    const ctx = await rowContext([conversation], req.auth.userId);
    const channel = await Channel.findById(conversation.channelId).select("type name state isActive").lean();
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
    const boundTicket =
      binding.ticketId && !binding.endedAt
        ? await Ticket.findById(binding.ticketId)
            .select("num title state deadline responsibles createdBy applicantId applicant company")
            .lean()
        : null;
    // Вне яруса заявок читателя карточка её не раскрывает (M7) — строка диалога
    // (conversationRow) при этом всё равно несёт номер заявки, это отдельное поле
    const ticket = boundTicket && ticketInScope(boundTicket, req.auth) ? boundTicket : null;
    const openTickets = conversation.companyId
      ? await Ticket.find({ $and: [{ "company._id": conversation.companyId, isClosed: false }, ticketListFilter(req.auth)] })
          .sort({ createdAt: -1 })
          .limit(6)
          .select("num title state deadline")
          .lean()
      : [];
    res.status(200).json({
      conversation: conversationRow(conversation, ctx),
      channel: channel ? { id: String(channel._id), type: channel.type, name: channel.name, state: channel.state, isActive: channel.isActive } : null,
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
      otherChannels: contactUser ? await otherChannelsOf(contactUser._id, conversation._id) : [],
      ticket: ticket
        ? {
            id: String(ticket._id),
            num: ticket.num,
            title: ticket.title,
            state: ticket.state,
            deadline: ticket.deadline,
            responsibles: (ticket.responsibles || []).map((r) => userName(r)),
            boundAt: binding.boundAt || null,
          }
        : null,
      openTickets: openTickets
        .filter((t) => !ticket || String(t._id) !== String(ticket._id))
        .slice(0, 5)
        .map((t) => ({ id: String(t._id), num: t.num, title: t.title, state: t.state, deadline: t.deadline })),
    });
  } catch (error) {
    next(wrap(error, "Не удалось загрузить диалог"));
  }
};

/** Собеседники, авторы и цитируемые сообщения для рядов ленты. */
const messageRefs = async (rows) => {
  const identities = byId(await ChannelIdentity.find({ _id: { $in: rows.map((m) => m.identityId).filter(Boolean) } }).lean());
  const replies = byId(await Message.find({ _id: { $in: rows.map((m) => m.replyToId).filter(Boolean) } }).lean());
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
  return { identities, users, replies };
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
      const filter = {
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
      const refs = await messageRefs(rows);
      const items = rows.map((m) => messageRow(m, refs));
      if (rows.length === limit) {
        const last = rows[rows.length - 1];
        return res.status(200).json({ items, serverTime: last.updatedAt, afterId: String(last._id), hasMore: true });
      }
      return res.status(200).json({ items, serverTime: capturedAt, hasMore: false });
    }

    const filter = { conversationId: conversation._id };
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
    const refs = await messageRefs(rows);
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
    const channel = await Channel.findById(conversation.channelId).select("type isActive settings").lean();
    if (channel?.isActive && GATEWAY_NETWORKS.includes(channel.type) && channel.settings?.markReadOnOpen !== false) {
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
      files: req.files || [],
      auth: req.auth,
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

exports.handled = async (req, res, next) => {
  try {
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
        .select("firstName lastName banned banExpires")
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
    const binding = conversation.binding || {};
    if (binding.ticketId && !binding.endedAt && String(binding.ticketId) !== String(ticket._id)) {
      const current = await Ticket.findById(binding.ticketId).select("isClosed").lean();
      if (current && !current.isClosed) return next(new AppError(`Диалог уже привязан к заявке №${binding.ticketNum}`, 409));
    }
    await bindConversation({ conversation, ticket, by: await me(req) });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось привязать диалог"));
  }
};

exports.unbind = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    res.status(200).json({ ok: await unbindConversation({ conversation, by: await me(req) }) });
  } catch (error) {
    next(wrap(error, "Не удалось отвязать диалог"));
  }
};

exports.attach = async (req, res, next) => {
  try {
    const conversation = await loadVisible(req);
    const ticket = await loadOpenTicket(req, req.body?.ticketNum);
    const ids = (Array.isArray(req.body?.messageIds) ? req.body.messageIds : []).filter(isId).slice(0, 200);
    if (!ids.length) return next(new AppError("Выберите сообщения", 400));
    const messages = await Message.find({ _id: { $in: ids }, conversationId: conversation._id, direction: { $ne: "system" } })
      .sort({ sentAt: 1, seq: 1 })
      .lean();
    const count = await attachMessages({ conversation, messages, ticket, mode: "manual" });
    if (count) await addSystemLine(conversation, { kind: "attached", ticketNum: ticket.num, by: await me(req), count });
    bus.bump({ topics: ["conversations"], ticketIds: [ticket._id] });
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
    await Conversation.updateOne({ _id: conversation._id }, { $set: { decision: { ticketId: null, ticketNum: null, at: null } } });
    // «Без заявки» обязано закрыть вопрос НАВСЕГДА для этого закрытия: не
    // сменить endReason на "manual" — rules.decideAttach снова спросит
    // «По заявке №X?» на следующее сообщение клиента (окно 30 дней после
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
    const user = await User.findOne({ _id: req.body.userId, isServiceAccount: { $ne: true } }).select("_id company isEndUser").lean();
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
      .select("firstName lastName position company banned banExpires")
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
    const applicant = req.ticket.applicantId
      ? await User.findById(req.ticket.applicantId).select("firstName lastName").lean()
      : null;
    res.status(200).json({ ...result, applicantName: userName(applicant) });
  } catch (error) {
    next(wrap(error, "Не удалось подобрать каналы ответа"));
  }
};
