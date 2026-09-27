import { Link } from "react-router";
import { RiArrowRightLine, RiLinkUnlink } from "react-icons/ri";

import { deadlineText, ticketTone } from "@/components/Ticket/ticket-state";
import { Button } from "@/components/ui/button";
import type { ConversationCard } from "@/types/conversation";
import { boundSinceLabel } from "@/util/conversation-format";

/**
 * Привязанная заявка в колонке собеседника (канва A1, B3): номер и «привязана
 * с 10:03», тема, статус и срок, ответственные; «Открыть заявку →» и
 * «Отвязать». Заявка вне яруса читателя приходит без подробностей
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
    <div className="rounded-xl border border-border px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-muted-foreground tabular-nums">
          {bound.num}
        </span>
        {ticket?.boundAt && (
          <span className="ms-auto text-xs text-faint">
            {boundSinceLabel(ticket.boundAt, { now, timeZone })}
          </span>
        )}
      </div>
      {ticket && (
        <>
          <div className="mt-0.5 text-sm font-medium">{ticket.title}</div>
          <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            {Glyph && <Glyph size={16} aria-hidden />}
            {tone?.label}
            <span className="text-faint">·</span>
            {deadlineText(ticket.deadline)}
          </div>
          {ticket.responsibles.length > 0 && (
            <div className="mt-0.5 text-sm text-muted-foreground">
              {ticket.responsibles.join(", ")}
            </div>
          )}
        </>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <Link
          to={`/tickets/${bound.num}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text no-underline hover:underline"
        >
          Открыть заявку
          <RiArrowRightLine size={16} aria-hidden />
        </Link>
        <span className="flex-1" />
        {canManage && (
          <Button variant="ghost" size="xs" onClick={onUnbind}>
            <RiLinkUnlink />
            Отвязать
          </Button>
        )}
      </div>
    </div>
  );
};

export default TicketBlock;
