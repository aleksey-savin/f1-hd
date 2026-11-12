import { Link } from "@/components/app/navigation";

import { RiGroupLine } from "react-icons/ri";

import CountPill from "@/components/app/CountPill";
import { cn } from "@/lib/utils";
import type { ConversationRow as Row } from "@/types/conversation";
import {
  lastMessagePrefix,
  listTimeLabel,
  networkLabel,
  waitLabel,
} from "@/util/conversation-format";

import { conversationTicketLabel } from "@/util/conversation-contact";

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
  const company =
    row.company?.alias ||
    (row.kind === "form" ? "Форма с сайта" : row.unknown ? "Не опознан" : "");

  return (
    <Link
      to={`/conversations/${row.id}`}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex gap-2.5 text-foreground no-underline transition-colors hover:bg-accent hover:text-foreground",
        phone ? "px-4 py-3" : "px-3 py-2.5",
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
        iconSize={phone ? 20 : 18}
        className={cn("rounded-xl", phone ? "size-11" : "size-9")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              phone
                ? "min-w-0 flex-1 truncate text-base leading-6"
                : "min-w-0 flex-1 text-sm leading-5",
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
        <div
          className={cn(
            "mt-1 truncate text-muted-foreground",
            phone ? "text-sm" : "text-xs",
          )}
        >
          {prefix && <span className="text-foreground">{prefix}: </span>}
          {row.lastMessage?.preview || "Сообщений пока нет"}
        </div>
        {company && (
          <strong
            className="mt-1 block truncate text-xs font-bold text-muted-foreground"
            title={company}
          >
            {company}
          </strong>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate text-faint">
            {conversationTicketLabel(row)}
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
