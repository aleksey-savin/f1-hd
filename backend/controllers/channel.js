const crypto = require("crypto");
const mongoose = require("mongoose");

const Channel = require("@/models/channel");
const Conversation = require("@/models/conversation");
const ChannelJob = require("@/models/channelJob");
const User = require("@/models/user");
const { AppError } = require("@/middleware/errorHandling");
const { isBanned } = require("@/services/authBan");
const { encryptSecret } = require("@/services/crypto/secretBox");
const { parsePhoneInput, isValidPhone } = require("@/services/phone");
const { enqueueJob } = require("@/services/messaging/jobs");
const { NETWORKS, GATEWAY_NETWORKS } = require("@/services/messaging/rules");

/**
 * Каналы «Диалогов» в настройках. Секреты принимаются и шифруются, но наружу
 * уходят только признаком «задан»; расшифрованными их видит лишь шлюз.
 * Команды шлюзу (вход, выход, прокси, история) — задания очереди.
 */

const SECRET_KEYS = ["tgApiId", "tgApiHash", "proxyPassword", "maxToken", "maxWebhookSecret"];
const wrap = (error, fallback) => (error instanceof AppError ? error : new AppError(fallback, 500, true, error));
const plain = (value) => (value?.toObject ? value.toObject() : value || {});

const publicChannel = (channel) => ({
  id: String(channel._id),
  type: channel.type,
  name: channel.name,
  isActive: channel.isActive,
  state: channel.state,
  stateReason: channel.stateReason || "",
  account: channel.account || {},
  login: channel.login || { qr: null, expiresAt: null },
  gatewaySeenAt: channel.gatewaySeenAt || null,
  lastMessageAt: channel.lastMessageAt || null,
  settings: channel.settings || {},
  secrets: Object.fromEntries(SECRET_KEYS.map((key) => [key, Boolean(channel.secrets?.[key])])),
  serviceUserId: channel.serviceUserId ? String(channel.serviceUserId) : null,
});

const cleanSettings = (raw = {}, current = {}) => {
  const next = { ...current };
  if (typeof raw.proxyUrl === "string") next.proxyUrl = raw.proxyUrl.trim().slice(0, 500);
  if (raw.historyDays !== undefined) next.historyDays = Math.min(Math.max(Number(raw.historyDays) || 0, 0), 90);
  for (const flag of ["importGroups", "markReadOnOpen", "signReplies"]) {
    if (typeof raw[flag] === "boolean") next[flag] = raw[flag];
  }
  if (raw.maxMediaMb !== undefined) next.maxMediaMb = Math.min(Math.max(Number(raw.maxMediaMb) || 50, 1), 200);
  if (Array.isArray(raw.ignoredChatIds)) next.ignoredChatIds = raw.ignoredChatIds.map(String).slice(0, 500);
  if (raw.site && typeof raw.site === "object") {
    next.site = { ...(current.site || {}) };
    if (Array.isArray(raw.site.allowedOrigins)) {
      next.site.allowedOrigins = raw.site.allowedOrigins
        .map((origin) => String(origin).trim())
        .filter((origin) => /^https?:\/\/[^/\s]+$/.test(origin))
        .slice(0, 20);
    }
    if (typeof raw.site.consentText === "string") next.site.consentText = raw.site.consentText.slice(0, 2000);
  }
  return next;
};

// Пустое значение секрета — «не менять» (как у почтовых каналов)
const sealSecrets = (raw = {}, current = {}) => {
  const next = { ...current };
  for (const key of SECRET_KEYS) {
    if (typeof raw[key] === "string" && raw[key].trim()) next[key] = encryptSecret(raw[key].trim());
  }
  return next;
};

/**
 * РУЛИНГ: автор зеркал «с телефона» (Channel.serviceUserId). Пусто/null —
 * снять автора (сработает служебная учётка по умолчанию, services/messaging/mirror.js).
 * Иначе — только существующий НЕ клиент (служебные учётки допускаются) и не
 * отключённый: `isBanned`, а не сырое поле `banned` — отключение может быть
 * временным и уже истёкшим (services/authBan.js).
 *
 * @param {*} raw — req.body.serviceUserId, может отсутствовать (undefined —
 *   «не меняем», ключ не пришёл в PATCH)
 * @param {string|mongoose.Types.ObjectId|null} current — текущее значение поля
 */
const resolveServiceUserId = async (raw, current) => {
  if (raw === undefined) return current;
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (!value) return null;
  if (!mongoose.isValidObjectId(value)) throw new AppError("Пользователь не найден", 404);
  const user = await User.findOne({ _id: value, isEndUser: false }).select("_id banned banExpires").lean();
  if (!user || isBanned(user)) throw new AppError("Автор ответов с телефона — только сотрудник", 400);
  return user._id;
};

const loadChannel = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Канал не найден", 404);
  const channel = await Channel.findById(req.params.id);
  if (!channel) throw new AppError("Канал не найден", 404);
  return channel;
};

exports.list = async (req, res, next) => {
  try {
    const channels = await Channel.find({}).sort({ createdAt: 1 }).lean();
    res.status(200).json({ channels: channels.map(publicChannel) });
  } catch (error) {
    next(wrap(error, "Не удалось загрузить каналы"));
  }
};

exports.create = async (req, res, next) => {
  try {
    const { type, name } = req.body || {};
    if (!NETWORKS.includes(type)) return next(new AppError("Тип канала: telegram, whatsapp, max или site", 400));
    if (!String(name || "").trim()) return next(new AppError("Назовите канал", 400));
    const settings = cleanSettings(req.body.settings, {});
    if (type === "site") {
      settings.site = { ...(settings.site || {}), formKey: crypto.randomBytes(24).toString("base64url") };
    }
    const serviceUserId = await resolveServiceUserId(req.body.serviceUserId, null);
    const channel = await Channel.create({
      type,
      name: String(name).trim().slice(0, 100),
      settings,
      secrets: sealSecrets(req.body.secrets, {}),
      serviceUserId,
      createdBy: req.auth.userId,
    });
    res.status(201).json({ channel: publicChannel(channel.toObject()) });
  } catch (error) {
    next(wrap(error, "Не удалось создать канал"));
  }
};

exports.update = async (req, res, next) => {
  try {
    const channel = await loadChannel(req);
    const body = req.body || {};
    if (typeof body.name === "string" && body.name.trim()) channel.name = body.name.trim().slice(0, 100);
    if (typeof body.isActive === "boolean") channel.isActive = body.isActive;
    if (body.settings) channel.settings = cleanSettings(body.settings, plain(channel.settings));
    if (body.secrets) channel.secrets = sealSecrets(body.secrets, plain(channel.secrets));
    if (Object.hasOwn(body, "serviceUserId")) {
      channel.serviceUserId = await resolveServiceUserId(body.serviceUserId, channel.serviceUserId);
    }
    await channel.save();
    res.status(200).json({ channel: publicChannel(channel.toObject()) });
  } catch (error) {
    next(wrap(error, "Не удалось сохранить канал"));
  }
};

exports.remove = async (req, res, next) => {
  try {
    const channel = await loadChannel(req);
    if (await Conversation.exists({ channelId: channel._id })) {
      return next(new AppError("У канала есть диалоги — отключите его вместо удаления", 409));
    }
    await ChannelJob.updateMany({ channelId: channel._id, state: "pending" }, { $set: { state: "cancelled", finishedAt: new Date() } });
    await Channel.deleteOne({ _id: channel._id });
    res.status(200).json({ ok: true });
  } catch (error) {
    next(wrap(error, "Не удалось удалить канал"));
  }
};

/** Команда шлюзу — задание очереди; результат читается через GET …/jobs/:jobId. */
const command = (type, build = () => ({})) => async (req, res, next) => {
  try {
    const channel = await loadChannel(req);
    if (!GATEWAY_NETWORKS.includes(channel.type)) {
      return next(new AppError("Эта команда — для каналов шлюза (Telegram, WhatsApp)", 409));
    }
    const payload = build(req);
    if (payload instanceof AppError) return next(payload);
    const job = await enqueueJob({ channelId: channel._id, network: channel.type, type, payload });
    if (type === "login" && payload.step === "start") {
      await Channel.updateOne({ _id: channel._id }, { $set: { state: "connecting", stateReason: "" } });
    }
    res.status(202).json({ jobId: String(job._id) });
  } catch (error) {
    next(wrap(error, "Не удалось передать команду шлюзу"));
  }
};

exports.login = command("login", (req) => {
  const step = req.body?.step;
  if (!["start", "phone", "code", "password"].includes(step)) {
    return new AppError("step: start | phone | code | password", 400);
  }
  let raw = typeof req.body?.value === "string" ? req.body.value.trim() : "";
  if (step !== "start" && !raw) return new AppError("Нужно значение для шага входа", 400);
  // Шлюзу номер уходит в E.164 с плюсом, как бы его ни набрали
  if (step === "phone") {
    const digits = parsePhoneInput(raw);
    if (!isValidPhone(digits)) return new AppError("Проверьте номер телефона", 400);
    raw = `+${digits}`;
  }
  return { step, value: raw ? encryptSecret(raw) : null };
});
exports.logout = command("logout");
exports.test = command("testProxy");
exports.history = command("loadHistory", (req) => ({
  days: Math.min(Math.max(Number(req.body?.days) || 14, 1), 90),
}));

exports.job = async (req, res, next) => {
  try {
    const channel = await loadChannel(req);
    if (!mongoose.isValidObjectId(req.params.jobId)) return next(new AppError("Задание не найдено", 404));
    const job = await ChannelJob.findOne({ _id: req.params.jobId, channelId: channel._id })
      .select("type state lastError result finishedAt")
      .lean();
    if (!job) return next(new AppError("Задание не найдено", 404));
    res.status(200).json({
      job: { id: String(job._id), type: job.type, state: job.state, error: job.lastError || "", result: job.result ?? null, finishedAt: job.finishedAt },
    });
  } catch (error) {
    next(wrap(error, "Не удалось прочитать задание"));
  }
};
