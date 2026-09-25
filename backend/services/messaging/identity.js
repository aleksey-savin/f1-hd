/**
 * Собеседник канала → личность (ChannelIdentity) и, при твёрдом основании,
 * пользователь HD. Основания: Telegram-id совпал с привязкой бота HD
 * (`User.telegramBot.chatId`), телефон нашёлся РОВНО у одного пользователя
 * (`findUsersByPhone`; телефон на двоих — не основание, см. linkCandidate),
 * код привязки MAX (P3) или ручное «Это он». По имени и нику — никогда:
 * «Андрей» из WhatsApp не повод считать его Андреем из Примавто.
 *
 * deps подменяются в тестах; в бою — modelDeps().
 */

const linkCandidate = async (network, sender, deps) => {
  if (network === "telegram") {
    const user = await deps.findUserByTelegramId(String(sender.id));
    if (user) return { user, method: "tgBot" };
  }
  const phone = deps.normalizePhone(sender.phone || "");
  if (phone) {
    const users = await deps.findUsersByPhone(phone);
    // Телефон на двоих (муж и жена, сменные операторы одной линии) — не
    // твёрдое основание: связываем только когда номер выводит ровно на одного
    if (users.length === 1) return { user: users[0], method: "phone" };
  }
  return null;
};

/** Поля записи: то, что принёс собеседник, и связь — если её ещё нет. */
const identityPatch = (existing, sender, link, normalizePhone) => {
  const set = {};
  if (sender.firstName) set.firstName = sender.firstName;
  if (sender.lastName) set.lastName = sender.lastName;
  if (sender.name) set.displayName = sender.name;
  if (sender.username) set.username = String(sender.username).replace(/^@/, "");
  const phone = normalizePhone(sender.phone || "");
  if (phone) set.phone = phone;
  if (sender.email) set.email = String(sender.email).toLowerCase();
  if (sender.isBot) set.isBot = true;
  // Ручное «Это он» сильнее автоматики: связанную личность не перепривязываем
  if (!existing?.userId && link) {
    set.userId = link.user._id;
    set.linkMethod = link.method;
    set.isStaff = link.user.isEndUser === false;
    set.companyId = link.user.company?._id || null;
  }
  return set;
};

const resolveIdentity = async (network, sender, deps) => {
  const existing = await deps.findIdentity(network, String(sender.id));
  const link = existing?.userId ? null : await linkCandidate(network, sender, deps);
  return deps.upsertIdentity(network, String(sender.id), identityPatch(existing, sender, link, deps.normalizePhone));
};

const USER_FIELDS = "_id company isEndUser isServiceAccount";

// Тот же приём, что и buildPhoneSuffixRegex в services/callerIdentityService
// (не экспортирован оттуда — не трогаем этот модуль, дублируем маленький кусок):
// последние 10 цифр, разделители между ними (пробел, скобки, дефис) не считаются
const buildPhoneSuffixRegex = (normalizedPhone) => {
  const last10 = String(normalizedPhone).replace(/\D/g, "").slice(-10);
  if (last10.length !== 10) return null;
  return new RegExp(`${last10.split("").join("[\\s()-]*")}$`);
};

const modelDeps = () => {
  const ChannelIdentity = require("@/models/channelIdentity");
  const User = require("@/models/user");
  const { normalizeRuPhone } = require("@/services/callerIdentityService");
  const { isBanned } = require("@/services/authBan");
  return {
    findIdentity: (network, externalId) => ChannelIdentity.findOne({ network, externalId }).lean(),
    upsertIdentity: (network, externalId, set) =>
      ChannelIdentity.findOneAndUpdate(
        { network, externalId },
        { $setOnInsert: { network, externalId }, ...(Object.keys(set).length ? { $set: set } : {}) },
        { upsert: true, returnDocument: "after" },
      ).lean(),
    findUserByTelegramId: (id) =>
      User.findOne({ "telegramBot.chatId": String(id), isServiceAccount: { $ne: true } }).select(USER_FIELDS).lean(),
    // До двух подходящих под номер — этого достаточно, чтобы linkCandidate
    // понял «больше одного» и отказался связывать (см. Task 7 triage)
    findUsersByPhone: async (phone) => {
      const suffixRegex = buildPhoneSuffixRegex(phone);
      if (!suffixRegex) return [];
      // Та же годность, что у findApplicantByPhone: не служебная учётка,
      // компания не отключена; банов Mongo-запрос не знает — isBanned после
      const candidates = await User.find({ phone: suffixRegex, isServiceAccount: { $ne: true }, "company.isActive": { $ne: false } })
        .select(`${USER_FIELDS} banned banExpires`)
        .limit(5)
        .lean();
      return candidates.filter((user) => !isBanned(user)).slice(0, 2);
    },
    normalizePhone: normalizeRuPhone,
  };
};

module.exports = { resolveIdentity, identityPatch, linkCandidate, modelDeps };
