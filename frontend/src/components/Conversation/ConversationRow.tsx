import { Link } from "react-router";
import { RiGroupLine } from "react-icons/ri";

import CountPill from "@/components/app/CountPill";
import { cn } from "@/lib/utils";
import type { ConversationRow as Row } from "@/types/conversation";
import {
  lastMessagePrefix,
  listTimeLabel,
  networkLabel,
  rowMeta,
  waitLabel,
} from "@/util/conversation-format";

import { ChannelTile } from "./ChannelGlyph";

/**
 * Строка списка «Диалогов» (канва A1, B1): плитка канала фирменного цвета ·
 * имя и время · последнее сообщение с подписью «Вы» / «с телефона» / автор
 * в группе · компания и номер заявки, «ждёт N мин» янтарём и непрочитанное.
 * Плитка здесь различает строки — канал разный у соседей (правило плитки
 * списка), поэтому она есть.
 */
const ConversationRow = ({
  row,
  first,
  selected,
  phone = false,
  now,
  timeZone,
  myName,
}: {
  row: Row;
  first: boolean;
  selected: boolean;
  phone?: boolean;
  now: Date;
  timeZone: string;
  myName: string;
}) => {
  const prefix = lastMessagePrefix(row.lastMessage, { kind: row.kind, myName });
  const meta = rowMeta(row);

  return (
    <Link
      to={`/conversations/${row.id}`}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex gap-3 px-4 py-3 text-foreground no-underline transition-colors hover:bg-accent hover:text-foreground",
        selected && "bg-primary/10 hover:bg-primary/10",
      )}
    >
      {!first && (
        <span
          aria-hidden
          className="absolute top-0 right-0 left-4 h-px bg-border-soft"
        />
      )}
      <ChannelTile
        network={row.network}
        iconSize={20}
        className={cn("rounded-xl", phone ? "size-11" : "size-10")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-base leading-6",
              row.unread ? "font-semibold" : "font-medium",
            )}
          >
            {row.kind === "group" && (
              <RiGroupLine
                size={15}
                aria-hidden
                className="me-1.5 inline-block align-[-2px] text-muted-foreground"
              />
            )}
            {row.title || networkLabel(row.network)}
          </span>
          <span className="flex-none text-xs text-faint tabular-nums">
            {listTimeLabel(row.lastMessage?.at, { now, timeZone })}
          </span>
        </div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground">
          {prefix && <span className="text-foreground">{prefix}: </span>}
          {row.lastMessage?.preview ?? ""}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate">
            {meta.map((part, index) => (
              <span key={`${part.text}-${index}`}>
                {index > 0 && <span className="text-faint"> · </span>}
                <span
                  className={
                    part.tone === "muted" ? "text-muted-foreground" : "text-faint"
                  }
                >
                  {part.text}
                </span>
              </span>
            ))}
          </span>
          {row.awaitingSince && (
            <span className="flex-none font-semibold whitespace-nowrap text-warning-text">
              ждёт {waitLabel(row.awaitingSince, now)}
            </span>
          )}
          {row.unread > 0 && <CountPill>{row.unread}</CountPill>}
        </div>
      </div>
    </Link>
  );
};

export default ConversationRow;
