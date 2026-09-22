import type { IconType } from "react-icons";
import {
  RiCalendarEventLine,
  RiChat3Line,
  RiFileTextLine,
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
  return "";
};

export const actorName = (actor: NotificationItem["actor"]): string =>
  actor ? `${actor.lastName || ""} ${actor.firstName || ""}`.trim() : "";

export const actorInitials = (actor: NotificationItem["actor"]): string =>
  `${actor?.lastName?.[0] ?? ""}${actor?.firstName?.[0] ?? ""}`.toUpperCase() ||
  "?";
