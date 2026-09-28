/**
 * Разовые раздачи новых прав существующим ролям. Не правило «всегда выводить»,
 * а один прогон: правило на каждом прогоне вернуло бы право роли, с которой
 * владелец его снял.
 */

// Роли стороннего исполнителя: человек из чужой компании заявки берёт, но
// права сотрудника сверх этого ему не раздаются.
const OUTSIDE_PERFORMER_ROLES = ["contractor-no-works"];

/**
 * Разовая раздача прав «Диалогов» (2026-09-25), `scripts/grantConversations.js`:
 * какие действия роль получает; [] — никаких.
 */
const conversationGrants = ({ key, audience, actions = [] }) => {
  if (audience === "client" || OUTSIDE_PERFORMER_ROLES.includes(key)) return [];
  const grants = [];
  if (actions.includes("ticket.perform") || actions.includes("ticket.manage")) {
    grants.push("conversation.read", "conversation.reply");
  }
  if (actions.includes("ticket.manage")) grants.push("conversation.manage");
  return grants.filter((id) => !actions.includes(id));
};

const flattenStatements = (statements = {}) =>
  Object.entries(statements).flatMap(([resource, actions]) =>
    (actions || []).map((action) => `${resource}.${action}`),
  );

module.exports = {
  flattenStatements,
  conversationGrants,
};
