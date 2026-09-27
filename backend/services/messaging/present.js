/**
 * Что «Диалоги» отдают наружу: строки списка и ленты (сотрудникам) и блок
 * `channel` комментария-зеркала, который видит и клиент в своей заявке — в нём
 * только имена. Чисто — тесты рядом.
 */
const { NETWORK_LABEL, identityName, previewOf } = require("./rules");

const idOf = (value) => (value ? String(value._id ?? value) : null);
const userName = (user) => (user ? `${user.lastName || ""} ${user.firstName || ""}`.trim() : "");

/** Имя для клиентских глаз: настоящее имя или «Собеседник» — не телефон и не ник. */
const publicName = (identity) => {
  if (!identity) return "Собеседник";
  const full = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim();
  return identity.displayName || full || "Собеседник";
};

/**
 * Подпись автора комментария-зеркала. Связанный пользователь подписи не требует —
 * его имя интерфейс берёт из автора комментария. Ответ с корпоративного
 * телефона подписан аккаунтом, неизвестный собеседник — именем и сетью.
 */
const mirrorAuthorName = ({ identity, message, channel, network }) => {
  if (message.direction === "out") {
    // Ответ из HD — автор комментария сам сотрудник, подпись канала не нужна
    if (message.origin === "hd") return "";
    return `${channel?.account?.displayName || channel?.name || "Корпоративный аккаунт"} · с телефона`;
  }
  if (identity?.userId) return "";
  return `${publicName(identity)} · ${NETWORK_LABEL[network] || network}`;
};

/** Блок `channel` комментария — поимённо, лишнее не проходит. */
const commentChannel = ({ network, conversationId, messageId, direction, authorName, status }, now = new Date()) => {
  const block = { network, conversationId, messageId, direction };
  if (authorName) block.authorName = String(authorName).slice(0, 200);
  if (status) {
    block.status = status;
    block.statusAt = now;
  }
  for (const key of Object.keys(block)) if (block[key] === undefined || block[key] === null) delete block[key];
  return block;
};

const get = (map, id) => (map && id ? map.get(String(id)) : undefined);

const conversationRow = (conversation, ctx = {}) => {
  const counterpart = get(ctx.identities, conversation.counterpartIdentityId);
  const user = counterpart?.userId ? get(ctx.users, counterpart.userId) : undefined;
  const company = get(ctx.companies, conversation.companyId);
  const assignee = get(ctx.users, conversation.assigneeId);
  const binding = conversation.binding || {};
  const last = conversation.lastMessage || {};
  const title =
    conversation.kind === "direct"
      ? userName(user) || identityName(counterpart) || conversation.title || ""
      : conversation.title || NETWORK_LABEL[conversation.network] || "";
  return {
    id: idOf(conversation),
    kind: conversation.kind,
    network: conversation.network,
    title,
    unknown: conversation.kind !== "group" && !user,
    company: company ? { id: idOf(company), alias: company.alias } : null,
    lastMessage: last.at
      ? { at: last.at, direction: last.direction, origin: last.origin, preview: last.preview || "", authorName: last.authorName || "" }
      : null,
    awaitingSince: conversation.awaitingSince || null,
    unread: Math.min(get(ctx.unread, idOf(conversation)) || 0, 99),
    ticket: binding.ticketId && !binding.endedAt ? { id: idOf(binding.ticketId), num: binding.ticketNum } : null,
    decision: conversation.decision?.ticketId
      ? { ticketId: idOf(conversation.decision.ticketId), ticketNum: conversation.decision.ticketNum }
      : null,
    assignee: assignee ? { id: idOf(assignee), name: userName(assignee) } : null,
    hidden: Boolean(conversation.hidden),
  };
};

/**
 * Кандидат «Это он» в панели «Кто это?» (`GET /identities/:id/candidates`):
 * имя, должность, компания — без почты и телефона, даже если нашли по ним.
 */
const candidateRow = (user) => ({
  id: idOf(user),
  name: userName(user),
  position: user.position || "",
  company: user.company?.alias || "",
});

const STAFF_ORIGINS = new Set(["hd", "device", "staff"]);

const messageRow = (message, ctx = {}) => {
  const identity = get(ctx.identities, message.identityId);
  const author = get(ctx.users, message.authorUserId) || (identity?.userId ? get(ctx.users, identity.userId) : undefined);
  const reply = get(ctx.replies, message.replyToId);
  const replyAuthor = reply ? get(ctx.users, reply.authorUserId) || get(ctx.identities, reply.identityId) : undefined;
  return {
    id: idOf(message),
    seq: message.seq,
    direction: message.direction,
    origin: message.origin,
    kind: message.kind,
    text: message.text || "",
    form: message.form?.fields ? message.form : null,
    sentAt: message.sentAt,
    editedAt: message.editedAt || null,
    deletedAt: message.deletedAt || null,
    author: {
      name: userName(author) || message.authorName || identityName(identity),
      userId: idOf(author),
      isStaff: STAFF_ORIGINS.has(message.origin) || Boolean(identity?.isStaff),
    },
    attachments: (message.attachments || []).map(({ name, originalName, mimetype, size, durationSec, status }) => ({
      name,
      originalName,
      mimetype,
      size,
      durationSec: durationSec ?? null,
      status,
    })),
    replyTo: reply
      ? {
          id: idOf(reply),
          authorName: userName(replyAuthor) || reply.authorName || identityName(replyAuthor),
          text: previewOf(reply),
        }
      : null,
    status: message.status,
    error: message.error || "",
    ticket: message.ticketId ? { id: idOf(message.ticketId), num: message.ticketNum } : null,
    attachMode: message.attachMode || null,
    suggestTicketId: idOf(message.suggestTicketId),
    event:
      message.direction === "system"
        ? {
            kind: message.event?.kind || "",
            ticketNum: message.event?.ticketNum ?? null,
            byName: message.event?.byName || "",
            targetName: message.event?.targetName || "",
            count: message.event?.count ?? null,
          }
        : null,
  };
};

module.exports = { userName, publicName, mirrorAuthorName, commentChannel, conversationRow, messageRow, candidateRow };
