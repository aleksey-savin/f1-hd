const mongoose = require("mongoose");
const { AppError } = require("@/middleware/errorHandling");
const { isBanned } = require("@/services/authBan");
const { isValidPhone, parsePhoneInput, toCanonicalPhone } = require("@/services/phone");
const { personSearchClauses } = require("@/services/personSearch");
const { canSeeConversation } = require("./visibility");
const { canReadInbox, loadMessageScope } = require("./access");
const { userName } = require("./present");
const { firstContactReason } = require("./first-contact");
const { attachmentsOf, queueOutbound } = require("./outbound");

const fail = (message, status = 400) => new AppError(message, status);
const USER_FIELDS = "_id firstName lastName company phone email deletedAt banned banExpires isServiceAccount isCloudTelephony";
const eligible = (user) => user && !user.deletedAt && !isBanned(user) && !user.isServiceAccount && !user.isCloudTelephony && user.company?.isActive !== false;
const canContact = (_user, auth) => canReadInbox(auth) && auth.can({ conversation: ["start", "reply"] });

/** Parse the public recipient boundary without coercing arrays or objects into addresses.
 * @param {{userId?: unknown, phone?: unknown}} input
 * @returns {{userId: string} | {phone: string}}
 */
const recipientInput = ({ userId, phone }) => {
  if ((userId != null && phone != null) || (userId == null && phone == null)) throw fail("Выберите одного получателя");
  if (userId != null) {
    if (typeof userId !== "string" || !/^[a-f\d]{24}$/i.test(userId)) throw fail("Некорректный идентификатор получателя");
    return { userId };
  }
  if (typeof phone !== "string" || phone.length > 64 || !/^[+\d\s()-]+$/.test(phone)) throw fail("Укажите действующий номер телефона");
  const canonical = parsePhoneInput(phone);
  if (!isValidPhone(canonical)) throw fail("Укажите действующий номер телефона");
  return { phone: canonical };
};
const requestIdInput = (value) => {
  if (typeof value !== "string" || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)) throw fail("Некорректный идентификатор отправки");
  return value.toLowerCase();
};
const requireStartAccess = async (auth) => {
  if (!canReadInbox(auth) || !auth?.can({ conversation: ["start", "reply"] })) throw fail("Недостаточно прав, чтобы начать диалог", 403);
  const prefs = await require("@/models/preferences").findOne({}).select("modules.messaging contacts").lean();
  if (!prefs?.modules?.messaging?.isActive) throw fail("Модуль «Диалоги» выключен", 409);
  return prefs;
};
const recipientOf = async (input, auth) => {
  if (input.userId) {
    const user = await require("@/models/user").findById(input.userId).select(USER_FIELDS).lean();
    if (!eligible(user) || !canContact(user, auth)) throw fail("Получатель не найден", 404);
    const phone = toCanonicalPhone(user.phone || "");
    return { userId: String(user._id), name: userName(user), phone: isValidPhone(phone) ? phone : "" };
  }
  // An entered number cannot bypass eligibility checks on a known HD card.
  // Multiple matches remain unlinked; every known owner must be contactable.
  const known = await require("@/models/user").find({ phone: input.phone }).select(USER_FIELDS).limit(20).lean();
  if (known.length >= 20 || known.some(user => !eligible(user) || !canContact(user, auth))) throw fail("Получатель не найден", 404);
  return { userId: null, name: "", phone: input.phone };
};
const startRecipients = async ({ q, auth }) => {
  await requireStartAccess(auth);
  if (typeof q !== "string") return { items: [] };
  const terms = personSearchClauses(q.slice(0, 100), ["firstName", "lastName", "phone", "email", "company.alias"], 4);
  if (!terms.length) return { items: [] };
  const filter = { deletedAt: null, isServiceAccount: { $ne: true }, isCloudTelephony: { $ne: true }, "company.isActive": { $ne: false } };
  const users = await require("@/models/user").find({ $and: [filter, ...terms] }).select(USER_FIELDS).sort({ lastName: 1, firstName: 1 }).limit(30).lean();
  return { items: users.filter(user => eligible(user) && canContact(user, auth)).slice(0, 15).map(user => ({
    id: String(user._id), name: userName(user), company: user.company?.alias || "", phone: user.phone || "", email: user.email || "",
  })) };
};
const routesFor = async (recipient, auth) => {
  auth = { ...auth, messagingScope: await loadMessageScope(auth) };
  const identityOr = [...(recipient.userId ? [{ userId: recipient.userId }] : []), ...(recipient.phone ? [{ phone: recipient.phone }] : [])];
  const identities = identityOr.length ? await require("@/models/channelIdentity").find({ $or: identityOr }).select("_id").lean() : [];
  const conversations = await require("@/models/conversation").find({ kind: "direct", $or: [
    { counterpartIdentityId: { $in: identities.map(identity => identity._id) } }, ...(recipient.phone ? [{ deliveryPhone: recipient.phone }] : []),
  ] }).lean();
  const channels = await require("@/models/channel").find({ type: { $in: ["telegram", "whatsapp", "max"] } }).lean();
  const inaccessible = conversations.some(conversation => conversation.hidden || !canSeeConversation(conversation, auth));
  const routes = [];
  for (const channel of channels) {
    const existing = conversations.filter(conversation => String(conversation.channelId) === String(channel._id));
    for (const conversation of existing.filter(conversation => !conversation.hidden && canSeeConversation(conversation, auth))) {
      routes.push({ id: String(conversation._id), target: "conversation", channelId: String(channel._id), conversationId: String(conversation._id), network: channel.type, kind: "direct", title: channel.name || "", boundHere: false, available: channel.isActive, reason: channel.isActive ? null : "Канал отключён" });
    }
    if (existing.length) {
      if (!routes.some(route => route.channelId === String(channel._id))) routes.push({ id: `phone:${channel._id}`, target: "phone", channelId: String(channel._id), conversationId: null, network: channel.type, kind: "direct", title: channel.name || "", boundHere: false, available: false, reason: "Начать диалог через это подключение нельзя" });
      continue;
    }
    if (!channel.isActive) continue;
    const reason = inaccessible ? "Начать диалог через это подключение нельзя" : firstContactReason(channel, recipient.phone ? recipient : null)?.replace("У заявителя", "У получателя") || null;
    routes.push({ id: `phone:${channel._id}`, target: "phone", channelId: String(channel._id), conversationId: null, network: channel.type, kind: "direct", title: channel.name || "", boundHere: false, available: !reason, reason });
  }
  return { routes, channels };
};
const startRoutes = async ({ userId, phone, auth }) => {
  await requireStartAccess(auth);
  const recipient = await recipientOf(recipientInput({ userId, phone }), auth);
  return { recipient, routes: (await routesFor(recipient, auth)).routes };
};
const receipt = message => ({ messageId: String(message._id), conversationId: message.conversationId ? String(message.conversationId) : null, status: message.status, ...(message.error ? { error: message.error } : {}) });
// This proves ownership of one durable start request, never chat-history access.
const isOwnStartRequest = (message, auth) => Boolean(message && !message.ticketId && message.recipientPhone && message.clientRequestId && message.direction === "out" && message.origin === "hd" && String(message.authorUserId) === String(auth.userId));
const visibleOutgoing = async (message, auth) => {
  if (!message || message.direction !== "out" || message.origin !== "hd" || String(message.authorUserId) !== String(auth.userId)) throw fail("Сообщение не найдено", 404);
  if (message.conversationId) {
    auth = { ...auth, messagingScope: await loadMessageScope(auth) };
    const conversation = await require("@/models/conversation").findById(message.conversationId).lean();
    if (!conversation || conversation.hidden || (!isOwnStartRequest(message, auth) && !canSeeConversation(conversation, auth))) throw fail("Сообщение не найдено", 404);
  } else if (message.recipientUserId) {
    await recipientOf({ userId: String(message.recipientUserId) }, auth);
  }
  return message;
};
const outgoingStatus = async ({ messageId, auth }) => {
  await requireStartAccess(auth);
  if (typeof messageId !== "string" || !mongoose.isValidObjectId(messageId)) throw fail("Сообщение не найдено", 404);
  return receipt(await visibleOutgoing(await require("@/models/message").findById(messageId).lean(), auth));
};
const startRequestStatus = async ({ clientRequestId, auth }) => {
  await requireStartAccess(auth);
  const message = await require("@/models/message").findOne({ authorUserId: auth.userId, clientRequestId: requestIdInput(clientRequestId) }).lean();
  return receipt(await visibleOutgoing(message, auth));
};
const duplicateReceipt = (message, files) => {
  const retained = new Set((message.attachments || []).map(attachment => attachment.name));
  return { ...receipt(message), duplicate: true, cleanupKeys: files.map(file => file.key).filter(key => key && !retained.has(key)) };
};
const rejectedUploadKeys = async ({ clientRequestId, files = [], auth }) => {
  let requestId;
  try { requestId = requestIdInput(clientRequestId); } catch { return files.map(file => file.key); }
  try {
    if (!auth?.userId) return [];
    const accepted = await require("@/models/message").findOne({ authorUserId: auth.userId, clientRequestId: requestId }).select("attachments.name").lean();
    return duplicateReceipt(accepted || {}, files).cleanupKeys;
  } catch {
    // Keep uploads when persistence cannot prove that no accepted message uses them.
    return [];
  }
};
const startConversation = async ({ userId, phone, routeId, text, files = [], clientRequestId, auth }) => {
  const prefs = await requireStartAccess(auth);
  const input = recipientInput({ userId, phone });
  const requestId = requestIdInput(clientRequestId);
  const Message = require("@/models/message");
  const existing = await Message.findOne({ authorUserId: auth.userId, clientRequestId: requestId }).lean();
  if (existing) return duplicateReceipt(await visibleOutgoing(existing, auth), files);
  if (text != null && typeof text !== "string") throw fail("Укажите текст сообщения");
  const body = (text || "").trim();
  const attachments = attachmentsOf(files);
  if (!body && !attachments.length) throw fail("Пустое сообщение");
  if (body.length > 20_000) throw fail("Сообщение длиннее 20 000 знаков");
  if (attachments.length > 20) throw fail("Не больше 20 вложений");
  const recipient = await recipientOf(input, auth);
  const { routes, channels } = await routesFor(recipient, auth);
  const route = typeof routeId === "string" && routes.find(item => item.id === routeId);
  if (!route) throw fail("Канал ответа не найден", 404);
  if (!route.available) throw fail(route.reason, 409);
  if (route.target !== "phone") throw fail("Откройте существующий диалог", 409);
  const author = await require("@/models/user").findById(auth.userId).select("_id firstName lastName").lean();
  if (!author) throw fail("Сотрудник не найден", 403);
  try {
    const message = await queueOutbound({ channel: channels.find(item => String(item._id) === route.channelId), text: body, attachments, author, prefs, recipient, clientRequestId: requestId });
    return receipt(message);
  } catch (error) {
    if (error.code !== 11000) throw error;
    const winner = await Message.findOne({ authorUserId: auth.userId, clientRequestId: requestId }).lean();
    if (!winner) throw error;
    return duplicateReceipt(await visibleOutgoing(winner, auth), files);
  }
};
module.exports = { isOwnStartRequest, recipientInput, requestIdInput, requireStartAccess, recipientOf, startRecipients, startRoutes, startConversation, outgoingStatus, startRequestStatus, rejectedUploadKeys };
