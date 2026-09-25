/**
 * Заявка из диалога («Создать заявку» — существующая форма заявки,
 * заполненная из выбранных сообщений) и маршруты ответа из заявки
 * («Ответить через»).
 */
const mongoose = require("mongoose");

const rules = require("./rules");
const { publicName, userName } = require("./present");
const { addSystemLine } = require("./conversationStore");
const { bindConversation } = require("./bindings");

const fail = (message, status) => {
  const { AppError } = require("@/middleware/errorHandling");
  return new AppError(message, status);
};

/** Экранирование для HTML-описания заявки (хранится как HTML, рендерится DOMPurify). */
const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Строки диалога → HTML-абзацы описания заявки; пустые строки не переносятся. */
const describeAsHtml = (lines) =>
  lines
    .filter((line) => line.trim())
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

const parseIds = (raw) => {
  let list = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      list = raw.split(",");
    }
  }
  const ids = (Array.isArray(list) ? list : [])
    .map((id) => String(id).trim())
    .filter((id) => mongoose.isValidObjectId(id));
  // Один и тот же id дважды (повтор в списке, двойной клик) — не повод отказать
  // в проверке «сообщения принадлежат этому диалогу»; первое вхождение решает
  return [...new Set(ids)].slice(0, 200);
};

const loadVisibleConversation = async (conversationId, auth) => {
  const Conversation = require("@/models/conversation");
  const { canSeeConversation } = require("./visibility");
  if (!mongoose.isValidObjectId(conversationId)) throw fail("Диалог не найден", 404);
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation || !canSeeConversation(conversation, auth)) throw fail("Диалог не найден", 404);
  return conversation;
};

/** До создания заявки: модуль включён, диалог виден, сообщения из него и ни в какой заявке. */
const prepareOrigin = async ({ auth, conversationId, messageIds }) => {
  const Preferences = require("@/models/preferences");
  const Message = require("@/models/message");
  const { Ticket } = require("@/models/ticket");
  const ChannelIdentity = require("@/models/channelIdentity");
  const prefs = await Preferences.findOne({}).select("modules.messaging").lean();
  if (!prefs?.modules?.messaging?.isActive) throw fail("Модуль «Диалоги» выключен", 409);
  if (!auth.can({ conversation: ["read"] })) throw fail("Недостаточно прав для диалогов", 403);
  const conversation = await loadVisibleConversation(conversationId, auth);
  // Живая привязка к другой открытой заявке: «Создать заявку» не должно молча
  // забрать чат — сначала его нужно отвязать (то же правило, что в deliveryRoutes)
  const binding = conversation.binding || {};
  if (conversation.kind === "direct" && binding.ticketId && !binding.endedAt) {
    const boundTicket = await Ticket.findById(binding.ticketId).select("_id isClosed").lean();
    if (boundTicket && !boundTicket.isClosed) {
      throw fail(`Диалог привязан к заявке №${binding.ticketNum} — отвяжите его, чтобы начать новую заявку`, 409);
    }
  }
  const ids = parseIds(messageIds);
  const messages = ids.length
    ? await Message.find({ _id: { $in: ids }, conversationId: conversation._id, direction: { $ne: "system" } }).sort({ sentAt: 1, seq: 1 }).lean()
    : [];
  if (messages.length !== ids.length) throw fail("Сообщения не из этого диалога", 400);
  const taken = messages.find((message) => message.ticketId);
  if (taken) throw fail(`Сообщение уже в заявке №${taken.ticketNum}`, 409);
  const counterpartId =
    conversation.counterpartIdentityId ||
    messages.find((message) => message.direction === "in" && message.identityId)?.identityId ||
    null;
  const counterpart = counterpartId ? await ChannelIdentity.findById(counterpartId).lean() : null;
  return {
    conversation,
    messages,
    counterpart,
    applicantId: counterpart?.userId || null,
    // Как у почты: не опознан — заявка на служебной учётке, имя — в realSender
    realSender:
      counterpart && !counterpart.userId ? `${publicName(counterpart)} · ${rules.NETWORK_LABEL[conversation.network]}` : null,
    source: rules.TICKET_SOURCE[conversation.network],
    companyId: conversation.companyId || counterpart?.companyId || null,
  };
};

/**
 * Компания заявки — заглушка, а не опознание: дефолтная компания настроек или
 * компания служебной учётки-заявителя по умолчанию. applyOrigin такую компанию
 * на диалог/контакт не переносит — иначе анонимный чат выглядел бы опознанным.
 */
const isPlaceholderCompany = async (companyId) => {
  const Preferences = require("@/models/preferences");
  const User = require("@/models/user");
  const prefs = await Preferences.findOne({}).select("defaultCompany defaultApplicant").lean();
  if (prefs?.defaultCompany?._id && String(prefs.defaultCompany._id) === String(companyId)) return true;
  const defaultApplicant = prefs?.defaultApplicant?._id
    ? await User.findById(prefs.defaultApplicant._id).select("company").lean()
    : null;
  return Boolean(defaultApplicant?.company?._id) && String(defaultApplicant.company._id) === String(companyId);
};

/** После сохранения заявки: сообщения — в неё, личный чат — привязать, файлы — копиями. */
const applyOrigin = async ({ ticket, origin, by }) => {
  const Message = require("@/models/message");
  const Conversation = require("@/models/conversation");
  const { Ticket } = require("@/models/ticket");
  const storage = require("@/services/storage");
  const { bus } = require("@/services/pulse");
  const { conversation, messages } = origin;

  if (messages.length) {
    await Message.updateMany(
      { _id: { $in: messages.map((message) => message._id) }, ticketId: null },
      { $set: { ticketId: ticket._id, ticketNum: ticket.num, attachMode: "origin" } },
    );
    const copies = [];
    for (const message of messages) {
      for (const attachment of message.attachments || []) {
        if (attachment.status !== "ready" || !attachment.name) continue;
        try {
          copies.push({
            mimetype: attachment.mimetype,
            mimeType: attachment.mimetype,
            name: await storage.copyObject(attachment.name),
            originalName: attachment.originalName,
            size: attachment.size,
          });
        } catch {
          // файла уже нет — заявка важнее вложения
        }
      }
    }
    if (copies.length) await Ticket.updateOne({ _id: ticket._id }, { $push: { attachments: { $each: copies } } });
  }

  if (conversation.kind === "direct") {
    // Выбранные сообщения уже в описании — привязываем без повторного вложения
    await bindConversation({ conversation, ticket, by, attachPending: false, eventKind: "ticketCreated" });
  } else {
    await addSystemLine(conversation, { kind: "ticketCreated", ticketNum: ticket.num, by });
  }

  // ChannelIdentity.companyId здесь не пишем никогда — «Создать заявку» не
  // ручное основание опознать контакт, это делает только linkIdentity (I6)
  const companyId = ticket.company?._id;
  if (companyId && !(await isPlaceholderCompany(companyId))) {
    await Conversation.updateOne({ _id: conversation._id, companyId: null }, { $set: { companyId } });
  }
  if (conversation.decision?.ticketId) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { decision: { ticketId: null, ticketNum: null, at: null } } });
  }
  bus.bump({ topics: ["conversations"], ticketIds: [ticket._id] });
};

/** Черновик формы заявки из выбранных сообщений. */
const ticketDraft = async ({ auth, conversationId, messageIds }) => {
  const Preferences = require("@/models/preferences");
  const User = require("@/models/user");
  const ChannelIdentity = require("@/models/channelIdentity");
  const origin = await prepareOrigin({ auth, conversationId, messageIds });
  const prefs = await Preferences.findOne({}).select("timezone").lean();
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: prefs?.timezone || "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
  const identities = new Map(
    (await ChannelIdentity.find({ _id: { $in: origin.messages.map((m) => m.identityId).filter(Boolean) } }).lean()).map((i) => [String(i._id), i]),
  );
  const users = new Map(
    (await User.find({ _id: { $in: [...identities.values()].map((i) => i.userId).filter(Boolean) } }).select("firstName lastName").lean()).map((u) => [String(u._id), u]),
  );
  const lines = origin.messages.map((message) => {
    const identity = identities.get(String(message.identityId));
    const who =
      message.direction === "out"
        ? message.authorName || "Мы"
        : userName(users.get(String(identity?.userId))) || publicName(identity);
    return `${who}, ${time.format(message.sentAt)}: ${rules.commentContent(message)}`;
  });
  return {
    // Описание заявки — HTML (DOMPurify на выходе), а не текст: строки диалога
    // экранируем и заворачиваем каждую в свой <p>, а не склеиваем через "\n"
    description: describeAsHtml(lines),
    applicantId: origin.applicantId ? String(origin.applicantId) : null,
    companyId: origin.companyId ? String(origin.companyId) : null,
    source: origin.source,
    attachments: origin.messages.reduce((n, m) => n + (m.attachments || []).filter((a) => a.status === "ready").length, 0),
  };
};

/**
 * Маршруты «Ответить через» для заявки: диалоги заявителя (личные и группы,
 * где он участник) и диалог, привязанный к этой заявке. Занятый другой открытой
 * заявкой — недоступен. По умолчанию: привязанный к этой заявке → канал
 * последнего сообщения клиента в заявке → «как сейчас» (уведомление).
 */
const deliveryRoutes = async (ticket) => {
  const Conversation = require("@/models/conversation");
  const ChannelIdentity = require("@/models/channelIdentity");
  const Channel = require("@/models/channel");
  const Comment = require("@/models/comment");
  const { Ticket } = require("@/models/ticket");

  const identities = ticket.applicantId ? await ChannelIdentity.find({ userId: ticket.applicantId }).select("_id").lean() : [];
  const ids = identities.map((identity) => identity._id);
  const or = [{ "binding.ticketId": ticket._id }];
  if (ids.length) or.push({ counterpartIdentityId: { $in: ids } }, { "participants.identityId": { $in: ids } });
  const conversations = await Conversation.find({ $or: or, hidden: { $ne: true } }).sort({ "lastMessage.at": -1 }).limit(20).lean();

  const channels = new Map(
    (await Channel.find({ _id: { $in: conversations.map((c) => c.channelId) } }).select("type isActive").lean()).map((c) => [String(c._id), c]),
  );
  const elsewhere = conversations
    .filter((c) => c.binding?.ticketId && !c.binding.endedAt && String(c.binding.ticketId) !== String(ticket._id))
    .map((c) => c.binding.ticketId);
  const openElsewhere = new Set(
    (elsewhere.length ? await Ticket.find({ _id: { $in: elsewhere }, isClosed: false }).select("_id").lean() : []).map((t) => String(t._id)),
  );

  const routes = conversations.map((conversation) => {
    const channel = channels.get(String(conversation.channelId));
    const bound = conversation.binding?.ticketId && !conversation.binding.endedAt ? String(conversation.binding.ticketId) : null;
    const reason = !channel?.isActive
      ? "канал отключён"
      : channel.type === "site"
        ? "ответ на форму сайта — позже"
        : bound && bound !== String(ticket._id) && openElsewhere.has(bound)
          ? `занят заявкой №${conversation.binding.ticketNum}`
          : null;
    return {
      conversationId: String(conversation._id),
      network: conversation.network,
      kind: conversation.kind,
      title: conversation.title || "",
      available: !reason,
      reason,
      boundHere: bound === String(ticket._id),
    };
  });

  let defaultRoute = routes.find((route) => route.boundHere && route.available)?.conversationId || null;
  if (!defaultRoute) {
    const last = await Comment.findOne({ ticketId: ticket._id, "channel.direction": "in" })
      .sort({ createdAt: -1 })
      .select("channel.conversationId")
      .lean();
    const id = last?.channel?.conversationId ? String(last.channel.conversationId) : null;
    if (id && routes.some((route) => route.conversationId === id && route.available)) defaultRoute = id;
  }
  return { routes, defaultRoute: defaultRoute || "notify" };
};

module.exports = { parseIds, describeAsHtml, prepareOrigin, applyOrigin, ticketDraft, deliveryRoutes };
