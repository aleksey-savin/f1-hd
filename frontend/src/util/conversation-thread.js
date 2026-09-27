/**
 * Лента «Диалогов»: слияние порций сообщений, курсор опроса `changedSince`
 * (контракт — docs/messaging.md, «The changedSince polling contract»),
 * разметка ленты (метки дней, отступы, подписи авторов) и сообщения, из которых
 * «Создать заявку» собирает описание. Чистые функции — тесты рядом:
 * `node --test src/util/conversation-thread.test.js`.
 */
import { dayLabel } from "./conversation-format.js";

/**
 * @typedef {import("../types/conversation").MessageRow} MessageRow
 * @typedef {{ type: "day", key: string, label: string }} DayRow
 * @typedef {{ type: "system", key: string, message: MessageRow }} SystemRow
 * @typedef {{ type: "message", key: string, message: MessageRow, side: "in" | "out", gap: number, showAuthor: boolean, showName: boolean }} BubbleRow
 * @typedef {DayRow | SystemRow | BubbleRow} ThreadRow
 * @typedef {{ since: string, afterId: string | null }} PollCursor
 */

/** Страница ленты: столько сообщений приезжает при открытии и по «Показать раньше». */
export const PAGE_SIZE = 50;

// Порядок показа — по seq: сервер нумерует сообщения диалога в порядке
// прихода, а опрос отдаёт их в порядке ИЗМЕНЕНИЯ (правка и статус двигают
// updatedAt), поэтому сортирует клиент (docs/messaging.md, §7)
const bySeq = (a, b) =>
  (a.seq ?? 0) - (b.seq ?? 0) ||
  String(a.sentAt).localeCompare(String(b.sentAt)) ||
  String(a.id).localeCompare(String(b.id));

/**
 * Слить порцию в ленту: тот же id — заменить (правка, статус), новый — добавить.
 * @template {{ id: string, seq: number, sentAt: string }} T
 * @param {T[]} current
 * @param {T[] | null | undefined} incoming
 * @returns {T[]}
 */
export const mergeMessages = (current, incoming) => {
  if (!incoming?.length) return current;
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(bySeq);
};

/**
 * Следующий курсор опроса. Полная страница (`hasMore`) — продолжаем с её
 * последней строки (`serverTime` + `afterId`) сразу же; неполная — следующий
 * опрос от метки сервера без `afterId`, чтобы не потерять записанное между
 * чтением базы и ответом.
 * @param {{ serverTime: string, hasMore: boolean, afterId?: string }} page
 * @returns {PollCursor & { drain: boolean }}
 */
export const nextCursor = (page) =>
  page.hasMore
    ? { since: page.serverTime, afterId: page.afterId ?? null, drain: true }
    : { since: page.serverTime, afterId: null, drain: false };

/**
 * Строка запроса опроса по курсору.
 * @param {PollCursor} cursor
 * @param {number} [limit]
 */
export const changesQuery = (cursor, limit = 200) => {
  const params = new URLSearchParams({
    changedSince: String(cursor.since),
    limit: String(limit),
  });
  if (cursor.afterId) params.set("afterId", cursor.afterId);
  return params.toString();
};

/**
 * Пришло ли новое входящее — повод отметить диалог прочитанным.
 * @param {Array<{ id: string, direction: string }>} changed
 * @param {Set<string>} knownIds
 */
export const hasNewInbound = (changed, knownIds) =>
  changed.some(
    (message) => message.direction === "in" && !knownIds.has(message.id),
  );

/**
 * Ряды ленты в мессенджерном порядке (старые сверху, канва A1):
 *   day     — метка дня перед первым сообщением дня;
 *   system  — системная строка («Создана заявка №…»);
 *   message — пузырь; `gap` — отступ сверху в px (4 — та же сторона,
 *             12 — смена стороны, 6 — после метки дня или системной строки),
 *             `showAuthor` — подпись автора над исходящим, `showName` — имя
 *             над входящим в группе.
 * @param {MessageRow[]} messages
 * @param {{ kind?: string, timeZone?: string, now?: Date }} [options]
 * @returns {ThreadRow[]}
 */
export const threadRows = (
  messages,
  { kind = "direct", timeZone, now = new Date() } = {},
) => {
  const rows = [];
  let lastDay = null;
  let previous = null;
  for (const message of messages) {
    const day = new Date(message.sentAt).toLocaleDateString("en-CA", {
      timeZone,
    });
    if (day !== lastDay) {
      rows.push({
        type: "day",
        key: `day-${day}`,
        label: dayLabel(message.sentAt, { now, timeZone }),
      });
      lastDay = day;
      previous = { type: "day" };
    }
    if (message.direction === "system") {
      rows.push({ type: "system", key: message.id, message });
      previous = { type: "system" };
      continue;
    }
    const side = message.direction === "out" ? "out" : "in";
    const authorKey = message.author?.userId || message.author?.name || "";
    const sameSide = previous?.type === "message" && previous.side === side;
    const sameAuthor = sameSide && previous.authorKey === authorKey;
    rows.push({
      type: "message",
      key: message.id,
      message,
      side,
      gap: previous?.type === "message" ? (sameSide ? 4 : 12) : 6,
      showAuthor: side === "out" && !sameAuthor,
      showName: side === "in" && kind === "group" && !sameAuthor,
    });
    previous = { type: "message", side, authorKey };
  }
  return rows;
};

/**
 * Сообщения для «Создать заявку» в личном чате (выбора сообщений в P1 нет):
 * хвост переписки назад до первого сообщения, уже лежащего в заявке, без
 * системных строк и удалённых, не больше `limit`. Возвращает id от старых к
 * новым — в этом порядке их прочтёт описание.
 * @param {MessageRow[]} messages
 * @param {{ limit?: number }} [options]
 * @returns {string[]}
 */
export const defaultDraftMessageIds = (messages, { limit = 20 } = {}) => {
  const picked = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "system" || message.deletedAt) continue;
    if (message.ticket) break;
    picked.push(message.id);
    if (picked.length >= limit) break;
  }
  return picked.reverse();
};
