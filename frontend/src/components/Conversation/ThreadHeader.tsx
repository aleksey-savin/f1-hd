import type { ReactNode } from "react";
import { RiGroupLine } from "react-icons/ri";

import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";
import { plural } from "@/util/plural";
import { counterpartHandle, networkLabel } from "@/util/conversation-format";

import { ChannelIcon } from "./ChannelGlyph";

/**
 * Шапка переписки (канва A1 — 64 px, B2 — плотная для телефона): имя, строка
 * «Telegram · @ник» и действия справа. Ожидание видно только в списке.
 */
const ThreadHeader = ({
  card,
  compact = false,
  children,
}: {
  card: ConversationCard;
  compact?: boolean;
  /** Действия справа: «Создать заявку», «⋯». */
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

export default ThreadHeader;
