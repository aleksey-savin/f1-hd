/**
 * Заявка и мессенджеры: маршруты «Ответить через», строка «Диалог» в
 * «Деталях», подпись автора и статус доставки у записи хроники. Чистые
 * функции — тесты рядом: `node --test src/util/delivery-routes.test.js`.
 *
 * Маршруты отдаёт `GET /api/tickets/:num/delivery-routes`
 * (backend/services/messaging/origin.js#deliveryRoutes).
 */
import { NETWORK_LABEL, networkLabel, shortPersonName } from "./conversation-format.js";
import { formatMailSender } from "./mail-sender.js";

/**
 * @typedef {import("../types/conversation").DeliveryRoute} DeliveryRoute
 * @typedef {import("../types/conversation").DeliveryRoutes} DeliveryRoutes
 * @typedef {{ createdAt: string, channel?: import("../types/conversation").CommentChannel | null }} ChannelComment
 */

/** «Почта и бот HD — как сейчас»: комментарий без доставки в мессенджер. */
export const NOTIFY_ROUTE = "notify";

/** Источники заявки из мессенджеров (backend/services/messaging/rules.js#TICKET_SOURCE). */
export const MESSENGER_SOURCES = new Set(["Telegram", "WhatsApp", "MAX", "Сайт"]);

/**
 * Заголовок пункта меню: «Telegram · Соколова Марина».
 * @param {DeliveryRoute} route
 * @param {string} [applicantName]
 */
export const routeTitle = (route, applicantName = "") =>
  `${networkLabel(route.network)} · ${route.title || applicantName || "собеседник"}`;

/**
 * Вторая строка пункта: занят — причиной, иначе вид чата и привязка.
 * @param {DeliveryRoute} route
 */
export const routeSubtitle = (route) => {
  if (!route.available) return route.reason || "недоступно";
  if (route.kind === "group") return "группа компании";
  return route.boundHere ? "личный чат · привязан к этой заявке" : "личный чат";
};

/**
 * Подпись кнопки выбора: «Telegram · Соколова М.»; без маршрута — «Почта и бот HD».
 * @param {DeliveryRoute | null | undefined} route
 * @param {string} [applicantName]
 */
export const routeTriggerLabel = (route, applicantName = "") =>
  route
    ? `${networkLabel(route.network)} · ${shortPersonName(route.title || applicantName) || "собеседник"}`
    : "Почта и бот HD";

/**
 * Маршрут, выбранный при открытии: тот, что предложил сервер, если он ещё
 * доступен; иначе «как сейчас». Занятый маршрут выбранным не встаёт никогда.
 * @param {DeliveryRoutes | null | undefined} data
 * @returns {string}
 */
export const initialRoute = (data) => {
  if (!data) return NOTIFY_ROUTE;
  const found = data.routes.find(
    (route) => route.conversationId === data.defaultRoute && route.available,
  );
  return found ? found.conversationId : NOTIFY_ROUTE;
};

/**
 * Строка «Диалог» в «Деталях»: привязанный к заявке чат, иначе чат последнего
 * сообщения клиента в хронике. Нет ни того, ни другого — строки нет.
 * @param {DeliveryRoute[] | null | undefined} routes
 * @param {ChannelComment[] | null | undefined} comments
 * @returns {DeliveryRoute | null}
 */
export const dialogRoute = (routes, comments) => {
  const list = routes ?? [];
  const bound = list.find((route) => route.boundHere);
  if (bound) return bound;
  const latest = [...(comments ?? [])]
    .filter(
      (comment) =>
        comment.channel?.conversationId && comment.channel.direction === "in",
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (!latest) return null;
  return (
    list.find(
      (route) => route.conversationId === String(latest.channel.conversationId),
    ) ?? null
  );
};

/**
 * «Telegram · личный чат» / «Telegram · группа».
 * @param {DeliveryRoute} route
 */
export const dialogLabel = (route) =>
  `${networkLabel(route.network)} · ${route.kind === "group" ? "группа" : "личный чат"}`;

/**
 * Имя автора записи хроники. У зеркала сообщения неопознанного собеседника
 * подпись канала «Андрей · Telegram» — сеть уже названа меткой рядом, поэтому
 * хвост « · Telegram» срезаем; «F1Lab Поддержка · с телефона» остаётся как
 * есть.
 *
 * Письмо от незарегистрированного отправителя (автор в БД — служебная учётка
 * `Preferences.defaultApplicant`, без блока канала) — никогда не имя этой
 * учётки: имя или адрес из `ticket.realSender` (`personName` тут не при чём —
 * его вызывающая сторона для такой записи не показывает клиенту, см.
 * `frontend/src/components/Ticket/Chronicle.jsx`), иначе «Отправитель письма».
 *
 * Иначе — автор комментария (сотрудник или связанный клиент), `personName`.
 * @param {{ channel?: import("../types/conversation").CommentChannel | null, createdBy?: { isServiceAccount?: boolean } | string | null } | null | undefined} comment
 * @param {string} [personName]
 * @param {string} [realSender] — `ticket.realSender`, только для писем от незарегистрированных отправителей
 * @returns {string}
 */
export const chronicleAuthorName = (comment, personName = "", realSender = "") => {
  const authorName = comment?.channel?.authorName?.trim();
  if (authorName) {
    const suffix = ` · ${NETWORK_LABEL[comment.channel.network] ?? ""}`;
    return authorName.endsWith(suffix) && authorName.length > suffix.length
      ? authorName.slice(0, -suffix.length)
      : authorName;
  }
  const author = comment?.createdBy;
  if (!comment?.channel && author && typeof author === "object" && author.isServiceAccount) {
    return formatMailSender(realSender) || realSender?.trim() || "Отправитель письма";
  }
  return personName;
};

/**
 * Статус доставки ответа в мессенджер → значок у метки канала: подпись для
 * `title`, вид значка и тон. `null` — статуса нет (входящее, обычный
 * комментарий).
 * @param {string | undefined} status
 * @returns {{ label: string, icon: "clock" | "check" | "double" | "warn", tone: "faint" | "accent" | "destructive" } | null}
 */
export const deliveryStatusMeta = (status) =>
  ({
    preparing: { label: "Готовится к отправке", icon: "clock", tone: "faint" },
    queued: { label: "В очереди", icon: "clock", tone: "faint" },
    sent: { label: "Отправлено", icon: "check", tone: "faint" },
    delivered: { label: "Доставлено", icon: "double", tone: "faint" },
    read: { label: "Прочитано", icon: "double", tone: "accent" },
    failed: { label: "Не доставлено", icon: "warn", tone: "destructive" },
  })[status] ?? null;
