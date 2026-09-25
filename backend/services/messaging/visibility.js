const mongoose = require("mongoose");

const { ticketTier, scopeCompanyIds } = require("@/services/ticketScope");

/**
 * Кто какие диалоги видит — ярусы как у заявок (services/ticketScope.js): все,
 * своих компаний, свои. Неопознанных собеседников (компания не известна) видят
 * все, кто видит диалоги: их кто-то должен разобрать. Назначенный диалог виден
 * назначенному всегда. Чисто относительно базы — тесты рядом.
 */

const oid = (id) => new mongoose.Types.ObjectId(String(id));

const visibilityFilter = (auth) => {
  const tier = ticketTier(auth);
  if (tier === "all") return {};
  const or = [{ companyId: null }, { assigneeId: oid(auth.userId) }];
  if (tier === "companies") {
    const ids = scopeCompanyIds(auth);
    if (ids.length) or.push({ companyId: { $in: ids.map(oid) } });
  }
  return { $or: or };
};

const QUEUES = ["awaiting", "mine", "unbound", "all", "hidden"];

/** Фильтр очереди «Диалогов»; null — такой очереди нет. */
const queueFilter = (queue, auth) => {
  const shown = { hidden: { $ne: true } };
  switch (queue) {
    case "awaiting":
      return { ...shown, awaitingSince: { $ne: null } };
    case "mine":
      return {
        ...shown,
        $or: [
          { assigneeId: oid(auth.userId) },
          { assigneeId: null, companyId: { $in: scopeCompanyIds(auth).map(oid) } },
        ],
      };
    case "unbound":
      return { ...shown, $or: [{ "binding.ticketId": null }, { "binding.endedAt": { $ne: null } }] };
    case "all":
      return shown;
    case "hidden":
      return { hidden: true };
    default:
      return null;
  }
};

/** Видимость, очередь и доп. условия — через $and: у каждого может быть свой $or. */
const listFilter = (queue, auth, extra = {}) => {
  const queuePart = queueFilter(queue, auth);
  if (!queuePart) return null;
  const parts = [visibilityFilter(auth), queuePart, extra].filter((part) => Object.keys(part).length);
  return { $and: parts };
};

/** Виден ли человеку этот диалог — то же правило в памяти, для карточки. */
const canSeeConversation = (conversation, auth) => {
  const tier = ticketTier(auth);
  if (tier === "all" || !conversation.companyId) return true;
  if (conversation.assigneeId && String(conversation.assigneeId) === String(auth.userId)) return true;
  return tier === "companies" && scopeCompanyIds(auth).includes(String(conversation.companyId));
};

module.exports = { QUEUES, visibilityFilter, queueFilter, listFilter, canSeeConversation };
