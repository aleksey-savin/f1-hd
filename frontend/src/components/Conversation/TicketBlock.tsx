import { useCrumbFrom } from "@/components/app/Crumbs";
import { Link } from "react-router";
import { RiLinkUnlink, RiTimeLine, RiUserLine } from "react-icons/ri";

import { deadlineText, ticketTone } from "@/components/Ticket/ticket-state";
import { Button } from "@/components/ui/button";
import TicketDialogLinks from "./TicketDialogLinks";

import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";

/** Номер открывает заявку, тело карточки выбирает контекст переписки. */
const TicketBlock = ({
  card,
  ticket: detail,
  selected = false,
  showOtherDialogs = false,
  onSelect,
  canManage,
  onUnbind,
}: {
  card: ConversationCard;
  ticket?: ConversationCard["ticket"];
  selected?: boolean;
  showOtherDialogs?: boolean;
  onSelect?: () => void;
  canManage: boolean;
  /** Сохранены для существующих вызовов компонента. */
  now?: Date;
  timeZone?: string;
  onUnbind: () => void;
}) => {
  const fromState = useCrumbFrom("Диалог");
  const ticket = detail === undefined ? card.ticket : detail;
  const bound = ticket ?? card.conversation.ticket;
  if (!bound) return null;
  const tone = ticket ? ticketTone({ state: ticket.state }) : null;
  const Glyph = tone?.glyph;
  const body = ticket && (
    <>
      <span className="mb-3 block break-words text-base leading-6 font-semibold">
        {ticket.title}
      </span>
      <span
        className={cn(
          "flex items-start gap-2 text-sm",
          tone?.tone === "warn" ? "text-warning-text" : "text-muted-foreground",
        )}
      >
        {Glyph && <Glyph size={16} aria-hidden className="mt-0.5 flex-none" />}
        <span className="min-w-0">{tone?.label}</span>
      </span>
      {ticket.deadline && (
        <span className="mt-2.5 flex items-start gap-2 text-sm text-muted-foreground">
          <RiTimeLine size={16} aria-hidden className="mt-0.5 flex-none" />
          <span className="min-w-0">{deadlineText(ticket.deadline)}</span>
        </span>
      )}
      {ticket.responsibles.length > 0 && (
        <span className="mt-2.5 flex items-start gap-2 text-sm text-muted-foreground">
          <RiUserLine size={16} aria-hidden className="mt-0.5 flex-none" />
          <span className="min-w-0 break-words">
            {ticket.responsibles.join(", ")}
          </span>
        </span>
      )}
    </>
  );

  return (
    <article
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border",
        selected && "ring-1 ring-primary",
      )}
    >
      <div className="flex min-h-10 items-center justify-between gap-2 px-4 pt-2">
        <Link
          to={`/tickets/${bound.num}`}
          state={fromState}
          aria-label={`Открыть заявку ${bound.num}`}
          className="inline-flex items-center max-sm:min-h-11 rounded text-xs font-semibold text-muted-foreground tabular-nums no-underline outline-none hover:text-accent-text hover:underline focus-visible:ring-4 focus-visible:ring-ring/50"
        >
          {bound.num}
        </Link>
        {canManage && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="max-sm:size-11"
            onClick={onUnbind}
            aria-label={`Отвязать заявку ${bound.num}`}
            title="Отвязать заявку"
          >
            <RiLinkUnlink />
          </Button>
        )}
      </div>
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`Выбрать заявку: ${ticket?.title || `${bound.num}`}`}
          className="block w-full cursor-pointer appearance-none rounded-b-xl border-0 bg-transparent px-4 pt-1 pb-4 text-left text-foreground outline-none hover:bg-accent/30 focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          {body || (
            <span className="text-sm text-muted-foreground">
              Выбрать заявку
            </span>
          )}
        </button>
      ) : (
        body && <div className="px-4 pt-1 pb-4">{body}</div>
      )}
      {showOtherDialogs && ticket && <TicketDialogLinks ticket={ticket} />}
    </article>
  );
};

export default TicketBlock;
