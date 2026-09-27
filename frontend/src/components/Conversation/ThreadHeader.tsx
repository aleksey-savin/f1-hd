import type { ReactNode } from "react";
import { Link } from "react-router";
import { RiGroupLine } from "react-icons/ri";

import { ticketTone } from "@/components/Ticket/ticket-state";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";
import { plural } from "@/util/plural";
import {
  counterpartHandle,
  networkLabel,
  waitLabel,
} from "@/util/conversation-format";

import { ChannelIcon } from "./ChannelGlyph";

/**
 * Шапка переписки (канва A1 — 64 px, B2 — плотная для телефона): имя, строка
 * «Telegram · @ник · ждёт ответа 12 мин» и действия справа.
 */
const ThreadHeader = ({
  card,
  now,
  compact = false,
  children,
}: {
  card: ConversationCard;
  now: Date;
  compact?: boolean;
  /** Действия справа: номер заявки или «Создать заявку», «⋯». */
  children?: ReactNode;
}) => {
  const { conversation, counterpart, participants } = card;
  const group = conversation.kind === "group";
  const parts: ReactNode[] = [
    <span key="net" className="inline-flex items-center gap-1.5">
      <ChannelIcon network={conversation.network} size={compact ? 13 : 14} />
      {networkLabel(conversation.network)}
    </span>,
  ];
  if (group) {
    parts.push(
      <span key="group">
        группа · {participants.length}{" "}
        {plural(participants.length, "участник", "участника", "участников")}
      </span>,
    );
  } else if (!compact && counterpartHandle(counterpart)) {
    parts.push(<span key="handle">{counterpartHandle(counterpart)}</span>);
  }
  if (conversation.awaitingSince) {
    parts.push(
      <span key="wait" className="font-semibold text-warning-text">
        ждёт ответа {waitLabel(conversation.awaitingSince, now)}
      </span>,
    );
  }

  return (
    <div
      className={cn(
        "flex flex-none items-center gap-2.5",
        compact
          ? "min-h-13 px-3 pt-1 pb-2.5"
          : "min-h-16 border-b border-border-soft ps-5 pe-4",
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 className="my-0 truncate text-base leading-6 font-semibold">
          {group && (
            <RiGroupLine
              size={16}
              aria-hidden
              className="me-1.5 inline-block align-[-2px] text-muted-foreground"
            />
          )}
          {conversation.title || networkLabel(conversation.network)}
        </h2>
        <div
          className={cn(
            "flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-muted-foreground",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {parts.map((part, index) => (
            <span key={index} className="inline-flex items-center gap-1.5">
              {index > 0 && <span className="text-faint">·</span>}
              {part}
            </span>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
};

/** Номер привязанной заявки со статусом — ссылкой на карточку (канва A1). */
export const TicketChip = ({
  num,
  state,
  small = false,
}: {
  num: number;
  state?: string | null;
  small?: boolean;
}) => {
  const tone = state ? ticketTone({ state }) : null;
  const Glyph = tone?.glyph;
  return (
    <Link
      to={`/tickets/${num}`}
      className={cn(
        "inline-flex flex-none items-center gap-1.5 rounded-lg border border-border font-semibold whitespace-nowrap text-foreground no-underline hover:bg-accent hover:text-foreground",
        small ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
      )}
    >
      {Glyph && <Glyph size={16} aria-hidden className="text-muted-foreground" />}
      №{num}
      {!small && tone && (
        <span className="font-normal text-muted-foreground">{tone.label}</span>
      )}
    </Link>
  );
};

export default ThreadHeader;
