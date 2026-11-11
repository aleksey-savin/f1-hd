import { Link } from "react-router";
import { RiLinkUnlink, RiTimeLine, RiUserLine } from "react-icons/ri";

import { deadlineText, ticketTone } from "@/components/Ticket/ticket-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";
import { boundSinceLabel } from "@/util/conversation-format";

/**
 * Привязанная заявка в колонке собеседника (канва A1, B3): номер и «привязана
 * с 10:03», тема, отдельные строки статуса, срока и ответственных.
 * Действия стоят друг под другом. Заявка вне яруса читателя приходит без подробностей
 * (`card.ticket` пуст) — тогда только номер.
 */
const TicketBlock = ({
  card,
  canManage,
  now,
  timeZone,
  onUnbind,
}: {
  card: ConversationCard;
  canManage: boolean;
  now: Date;
  timeZone: string;
  onUnbind: () => void;
}) => {
  const bound = card.conversation.ticket;
  if (!bound) return null;
  const ticket = card.ticket;
  const tone = ticket ? ticketTone({ state: ticket.state }) : null;
  const Glyph = tone?.glyph;

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border">
      <div className="p-4">
        <div className="text-xs font-semibold text-muted-foreground tabular-nums">
          №{bound.num}
        </div>
        {ticket && (
          <>
            <h3 className="mt-1 mb-3 break-words text-base leading-6 font-semibold">
              {ticket.title}
            </h3>
            <div
              className={cn(
                "flex items-start gap-2 text-sm",
                tone?.tone === "warn"
                  ? "text-warning-text"
                  : "text-muted-foreground",
              )}
            >
              {Glyph && (
                <Glyph size={16} aria-hidden className="mt-0.5 flex-none" />
              )}
              <span className="min-w-0">{tone?.label}</span>
            </div>
            {ticket.deadline && (
              <div className="mt-2.5 flex items-start gap-2 text-sm text-muted-foreground">
                <RiTimeLine
                  size={16}
                  aria-hidden
                  className="mt-0.5 flex-none"
                />
                <span className="min-w-0">{deadlineText(ticket.deadline)}</span>
              </div>
            )}
            {ticket.responsibles.length > 0 && (
              <div className="mt-2.5 flex items-start gap-2 text-sm text-muted-foreground">
                <RiUserLine
                  size={16}
                  aria-hidden
                  className="mt-0.5 flex-none"
                />
                <span className="min-w-0 break-words">
                  {ticket.responsibles.join(", ")}
                </span>
              </div>
            )}
          </>
        )}
        {ticket?.boundAt && (
          <div className="mt-4 text-xs text-faint">
            {boundSinceLabel(ticket.boundAt, { now, timeZone })}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 border-t border-border-soft p-2">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="w-full text-accent-text"
        >
          <Link to={`/tickets/${bound.num}`}>Открыть заявку</Link>
        </Button>
        {canManage && (
          <Button
            variant="ghost"
            size="xs"
            className="w-full"
            onClick={onUnbind}
          >
            <RiLinkUnlink />
            Отвязать
          </Button>
        )}
      </div>
    </div>
  );
};

export default TicketBlock;
