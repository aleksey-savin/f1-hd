/**
 * Правила «Диалогов» без базы: кто ждёт ответа, куда прикрепить сообщение,
 * куда двигать статус доставки, чем назвать сообщение без текста. Всё чистое —
 * тесты рядом (rules.test.js). Спека: docs/superpowers/specs/2026-09-24-omnichannel-dialogs-design.md.
 */

const NETWORKS = ["telegram", "whatsapp", "max", "site"];
// Сети, чьи сессии держит шлюз msg-gateway; MAX и форма живут в бэкенде
const GATEWAY_NETWORKS = ["telegram", "whatsapp"];
const NETWORK_LABEL = { telegram: "Telegram", whatsapp: "WhatsApp", max: "MAX", site: "Форма с сайта" };
// Источник заявки (models/ticket.js) по сети диалога
const TICKET_SOURCE = { telegram: "Telegram", whatsapp: "WhatsApp", max: "MAX", site: "Сайт" };
const MESSAGE_KINDS = ["text", "photo", "voice", "audio", "video", "document", "sticker", "location", "contact", "form", "other"];
// Сколько после закрытия заявки новое сообщение клиента ещё спрашивает «о ней?»
const DECISION_WINDOW_MS = 30 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 2 * 60_000, 8 * 60_000, 30 * 60_000, 30 * 60_000];

const time = (value) => new Date(value).getTime();

/**
 * «Ждёт ответа» после сообщения: `{ awaitingSince }` для записи или null —
 * ничего не менять. История и системные строки очередь не трогают. Клиент
 * ставит отметку, только если её нет (ждём с первого неотвеченного). Любой наш
 * ответ — из HD, с телефона, сотрудником в группе — новее отметки её снимает;
 * опоздавший старый — нет.
 */
const nextAwaiting = (conversation, message) => {
  if (message.imported || message.direction === "system") return null;
  const since = conversation.awaitingSince ? time(conversation.awaitingSince) : null;
  const at = time(message.sentAt);
  if (message.direction === "in" && message.origin === "client") {
    if (since !== null) return null;
    // Опоздавшее сообщение клиента старше уже отправленного ответа — мы на
    // него уже ответили, переспрашивать не о чем (M8)
    const last = conversation.lastMessage;
    if (last?.direction === "out" && time(last.at) > at) return null;
    return { awaitingSince: new Date(at) };
  }
  if (since !== null && at >= since) return { awaitingSince: null };
  return null;
};

const NONE = Object.freeze({ mode: null, ticketId: null, ticketNum: null });

/**
 * Куда сообщение попадает в заявке.
 *   direct — живая привязка к открытой заявке: «bound». Заявку закрыли или
 *     удалили в обход хука — привязка кончается здесь же, и сообщение клиента о
 *     закрытой заявке задаёт вопрос (decision). Привязка кончилась закрытием
 *     раньше — первое сообщение клиента в окне тоже спрашивает, один раз.
 *   group — ответ цитатой на сообщение открытой заявки: «reply»; закрытой —
 *     только подсказка.
 *   form — никогда.
 * История и отправленное из HD сюда не попадают: второе кладёт в заявку отправка.
 */
const decideAttach = ({ conversation, message, boundTicket = null, replyToTicket = null }) => {
  if (message.imported || message.origin === "hd" || message.direction === "system") return { ...NONE };
  const fromClient = message.direction === "in" && message.origin === "client";

  if (conversation.kind === "direct") {
    const binding = conversation.binding || {};
    if (!binding.ticketId) return { ...NONE };
    if (!binding.endedAt) {
      if (boundTicket && !boundTicket.isClosed) {
        return { mode: "bound", ticketId: boundTicket._id, ticketNum: boundTicket.num };
      }
      if (!boundTicket) return { ...NONE, endBinding: "deleted" };
      const ended = { ...NONE, endBinding: "closed" };
      return fromClient ? { ...ended, decision: { ticketId: boundTicket._id, ticketNum: boundTicket.num } } : ended;
    }
    const recent =
      binding.endReason === "closed" && time(message.sentAt) - time(binding.endedAt) <= DECISION_WINDOW_MS;
    if (fromClient && recent && !conversation.decision?.ticketId) {
      return { ...NONE, decision: { ticketId: binding.ticketId, ticketNum: binding.ticketNum } };
    }
    return { ...NONE };
  }

  if (conversation.kind === "group" && replyToTicket) {
    if (!replyToTicket.isClosed) {
      return { mode: "reply", ticketId: replyToTicket._id, ticketNum: replyToTicket.num };
    }
    return { ...NONE, suggestTicketId: replyToTicket._id };
  }
  return { ...NONE };
};

const STATUS_RANK = { received: 0, queued: 1, sent: 2, delivered: 3, read: 4 };

/** Статус доставки только растёт; «failed» — из очереди или отправки, не после доставки. */
const advanceStatus = (current, next) => {
  if (next === "failed") return current === "queued" || current === "sent" ? "failed" : current;
  if (!(next in STATUS_RANK)) return current;
  if (current === "failed") return STATUS_RANK[next] >= STATUS_RANK.sent ? next : current;
  return STATUS_RANK[next] > (STATUS_RANK[current] ?? 0) ? next : current;
};

const KIND_LABEL = {
  photo: "Фото",
  voice: "Голосовое",
  audio: "Аудио",
  video: "Видео",
  document: "Файл",
  sticker: "Стикер",
  location: "Геопозиция",
  contact: "Контакт",
  other: "Сообщение",
};

const duration = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/**
 * Текст комментария-зеркала. У сообщения без текста — подпись вложения:
 * content у Comment обязателен, а пустая запись в хронике читалась бы как сбой.
 */
const commentContent = (message) => {
  const text = String(message.text || "").trim();
  if (text) return text;
  if (message.kind === "form") {
    return (message.form?.fields || []).map((field) => `${field.label}: ${field.value}`).join("\n") || "Форма с сайта";
  }
  const label = KIND_LABEL[message.kind] || KIND_LABEL.other;
  const first = (message.attachments || [])[0];
  if (message.kind === "voice" && first?.durationSec) return `${label} ${duration(first.durationSec)}`;
  if (message.kind === "document" && first?.originalName) return `${label} «${first.originalName}»`;
  return label;
};

/** Строка списка: одна строка текста, не длиннее 140 знаков. */
const previewOf = (message) => commentContent(message).replace(/\s+/g, " ").trim().slice(0, 140);

/** Как назвать собеседника, пока он не связан с пользователем. */
const identityName = (identity) => {
  if (!identity) return "";
  const full = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim();
  return (
    identity.displayName ||
    full ||
    (identity.username ? `@${identity.username}` : "") ||
    identity.phone ||
    identity.externalId ||
    ""
  );
};

/** Пауза перед повтором задания после `attempts` неудач: 30 с → 30 мин. */
const backoffMs = (attempts) =>
  BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];

/**
 * Подпись к ответу клиенту: имя сотрудника и организация — и ничего больше
 * (правило «клиенту — никаких личных контактов сотрудников»).
 */
const signReply = (text, { firstName = "", organization = "" } = {}) => {
  const who = [firstName, organization].filter(Boolean).join(", ");
  return who ? `${text}\n\n— ${who}` : text;
};

module.exports = {
  NETWORKS,
  GATEWAY_NETWORKS,
  NETWORK_LABEL,
  TICKET_SOURCE,
  MESSAGE_KINDS,
  DECISION_WINDOW_MS,
  MAX_ATTEMPTS,
  nextAwaiting,
  decideAttach,
  advanceStatus,
  commentContent,
  previewOf,
  identityName,
  backoffMs,
  signReply,
};
