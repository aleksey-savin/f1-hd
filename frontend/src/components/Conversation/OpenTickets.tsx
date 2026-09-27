import { Link } from "react-router";
import { RiLinkM } from "react-icons/ri";

import { SubLabel } from "@/components/app/Panel";
import { ticketTone } from "@/components/Ticket/ticket-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";

/**
 * Открытые заявки компании собеседника (канва A1): номер, тема, статус
 * глифом; «Привязать» — пока личный чат ни к чему не привязан (привязанный
 * сервер к другой открытой заявке не пустит — 409).
 */
const OpenTickets = ({
  card,
  canBind,
  onBind,
}: {
  card: ConversationCard;
  canBind: boolean;
  onBind: (num: number) => void;
}) => {
  const tickets = card.openTickets;
  if (!tickets.length) return null;
  const company = card.contact?.company || card.conversation.company?.alias || "";

  return (
    <>
      <SubLabel className="mt-5" count={tickets.length}>
        {company ? `Открытые заявки ${company}` : "Открытые заявки"}
      </SubLabel>
      {tickets.map((ticket, index) => {
        const tone = ticketTone({ state: ticket.state });
        const Glyph = tone.glyph;
        return (
          <div
            key={ticket.id}
            className={cn(
              "flex items-center gap-2.5 py-2",
              index > 0 && "border-t border-border-soft",
            )}
          >
            <span className="flex-none self-start text-sm font-medium text-muted-foreground tabular-nums">
              {ticket.num}
            </span>
            <span className="min-w-0 flex-1">
              <Link
                to={`/tickets/${ticket.num}`}
                className="block truncate text-sm text-foreground no-underline hover:underline"
              >
                {ticket.title}
              </Link>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs",
                  tone.tone === "warn" ? "text-warning-text" : "text-muted-foreground",
                )}
              >
                <Glyph size={13} aria-hidden />
                {tone.label}
              </span>
            </span>
            {canBind && (
              <Button variant="outline" size="xs" onClick={() => onBind(ticket.num)}>
                <RiLinkM />
                Привязать
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
};

export default OpenTickets;
