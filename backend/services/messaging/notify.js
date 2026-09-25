/**
 * Колокольчик о сообщении, которое ждёт ответа и не попало в заявку (у
 * привязанного чата будит уведомление о комментарии). Кому: назначенному;
 * нет его — ответственным за компанию; нет компании — тем, кто ведёт диалоги.
 */
const { previewOf } = require("./rules");

const USER_FIELDS = "_id firstName lastName notify isServiceAccount banned isEndUser";

/**
 * Назначенный → ответственные компании → ведущие диалоги — но считаются
 * только те, кто вообще может ОТКРЫТЬ диалог: колокольчик на страницу без
 * доступа никому не нужен. Группа без подходящего человека не тупик — идём
 * дальше по цепочке (M6).
 */
const recipientsFor = async (conversation) => {
  const User = require("@/models/user");
  const { permissionFilter } = require("@/services/permissions");
  const canRead = await permissionFilter("conversation.read");

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

const notifyWaiting = async ({ conversation, message, title }) => {
  const { pushInApp } = require("@/services/inAppNotifications");
  return pushInApp({
    recipients: await recipientsFor(conversation),
    category: "conversationMessage",
    kind: "conversationWaiting",
    title,
    text: previewOf(message),
    link: `/conversations/${conversation._id}`,
  });
};

module.exports = { notifyWaiting, recipientsFor };
