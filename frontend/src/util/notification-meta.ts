import type { IconType } from "react-icons";
import {
  RiCalendarEventLine,
  RiChat3Line,
  RiDiscussLine,
  RiFileTextLine,
  RiLinkUnlinkM,
  RiRouterLine,
} from "react-icons/ri";

import type { NotificationItem } from "@/types/notification";
import { EVENT_TONE_CLASS, eventMeta } from "@/util/ticket-events";

/**
 * Иконка и тон строки колокольчика — тот же каталог, что у хроники
 * (util/ticket-events), плюс виды, которых в ленте заявки нет: сам
 * комментарий (лента его показывает текстом) и события вне заявок.
 */
type Meta = { icon: IconType; tone: string };

const EXTRA: Record<string, Meta> = {
  comment: { icon: RiChat3Line, tone: "muted" },
  absenceRequest: { icon: RiCalendarEventLine, tone: "muted" },
  absenceDecision: { icon: RiCalendarEventLine, tone: "muted" },
  reportApproval: { icon: RiFileTextLine, tone: "muted" },
  reportDecision: { icon: RiFileTextLine, tone: "muted" },
  // Запрос ИИ-агента на изменение Mikrotik (backend/services/mikrotik/
  // changeNotify): шаг ждёт решения — тон ожидания, итог — нейтральный, исход
  // назван в тексте
  mikrotikChangeStep: { icon: RiRouterLine, tone: "warn" },
  mikrotikChangeResult: { icon: RiRouterLine, tone: "muted" },
  // «Диалоги»: сообщение ждёт ответа (backend/services/messaging/notify.js)
  conversationWaiting: { icon: RiDiscussLine, tone: "warn" },
  // Канал связи отключился — сессия, блокировка, ошибка; администраторам
  // (backend/services/messaging/channelAlert.js)
  channelState: { icon: RiLinkUnlinkM, tone: "bad" },
};

export const notificationMeta = (kind: string): Meta => {
  const extra = EXTRA[kind];
  if (extra) return extra;
  const meta = eventMeta(kind);
  return { icon: meta.icon, tone: meta.tone };
};

// Каталог тонов — JS-модуль, граница типов: расширяем до словаря строк
const TONE_CLASS: Record<string, string> = EVENT_TONE_CLASS;

export const toneClass = (tone: string): string =>
  TONE_CLASS[tone] ?? TONE_CLASS.muted;

/** Третья строка: где это случилось — заявка или раздел */
export const notificationContext = (item: NotificationItem): string => {
  if (item.ticketNum) {
    return [String(item.ticketNum), item.ticketTitle].filter(Boolean).join(" · ");
  }
  if (item.link.startsWith("/team/calendar")) return "Календарь команды";
  if (item.link.includes("/approval")) return "Согласование работ";
  if (item.link.startsWith("/conversations")) return "Диалоги";
  if (item.link.startsWith("/preferences#channels")) {
    return "Настройки системы · Каналы связи";
  }
  return "";
};

export const actorName = (actor: NotificationItem["actor"]): string =>
  actor ? `${actor.lastName || ""} ${actor.firstName || ""}`.trim() : "";

export const actorInitials = (actor: NotificationItem["actor"]): string =>
  `${actor?.lastName?.[0] ?? ""}${actor?.firstName?.[0] ?? ""}`.toUpperCase() ||
  "?";
