/**
 * Колокольчик о сообщении, которое ждёт ответа и не попало в заявку (у
 * привязанного чата будит уведомление о комментарии). Кому: назначенному;
 * нет его — ответственным за компанию; нет компании — тем, кто ведёт диалоги.
 */
const { previewOf } = require("./rules");

const USER_FIELDS = "_id firstName lastName notify isServiceAccount deletedAt banned isEndUser";

/**
 * Назначенный → ответственные компании → ведущие диалоги — но считаются
 * только те, кто вообще может ОТКРЫТЬ диалог: колокольчик на страницу без
 * доступа никому не нужен. Группа без подходящего человека не тупик — идём
 * дальше по цепочке (M6).
 */
const globalRecipientsFor = async (conversation) => {
  const User = require("@/models/user");
  const { permissionFilter } = require("@/services/permissions");
  const canRead = await permissionFilter("conversation.readAll");

  if (conversation.assigneeId) {
    const assignee = await User.find({ $and: [{ _id: conversation.assigneeId }, canRead] }).select(USER_FIELDS).lean();
    if (assignee.length) return assignee;
  }
  if (conversation.companyId) {
    const Company = require("@/models/company");
    const company = await Company.findById(conversation.companyId).select("responsibles").lean();
    // В карточке компании ответственный хранится ссылкой в поле `id`
    const ids = (company?.responsibles || []).map((r) => r.id || r._id).filter(Boolean);
    if (ids.length) {
      const responsibles = await User.find({ $and: [{ _id: { $in: ids }, isEndUser: false }, canRead] }).select(USER_FIELDS).lean();
      if (responsibles.length) return responsibles;
    }
  }
  const canManage = await permissionFilter("conversation.manage");
  return User.find({ $and: [canManage, canRead] }).select(USER_FIELDS).lean();
};

const recipientsFor = async (conversation, message) => {
  const recipients = await globalRecipientsFor(conversation);
  if (!message?.discussionUserId || message.ticketId || message.attachMode !== 'free') return recipients;
  const { permissionFilter } = require('@/services/permissions');
  const owner = await require('@/models/user').find({ $and: [
    { _id: message.discussionUserId },
    { $or: [await permissionFilter('conversation.read'), await permissionFilter('conversation.readAll')] },
  ] }).select(USER_FIELDS).lean();
  return [...new Map([...recipients, ...owner].map(user => [String(user._id), user])).values()];
};

const notifyWaiting = async ({ conversation, message, title }) => {
  const { pushInApp } = require("@/services/inAppNotifications");
  return pushInApp({
    recipients: await recipientsFor(conversation, message),
    category: "conversationMessage",
    kind: "conversationWaiting",
    title,
    text: previewOf(message),
    link: `/conversations/${conversation._id}`,
  });
};

module.exports = { notifyWaiting, recipientsFor };
