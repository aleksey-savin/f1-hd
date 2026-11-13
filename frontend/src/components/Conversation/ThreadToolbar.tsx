import {
  RiArrowDownSLine,
  RiChat1Line,
  RiCheckLine,
  RiHistoryLine,
  RiLayoutRightLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TicketStateText, ticketTone } from "@/components/Ticket/ticket-state";
import { cn } from "@/lib/utils";
import type {
  ConversationCard,
  ConversationReplySelection,
} from "@/types/conversation";
import { conversationTickets } from "@/util/conversation-context";

/** Choosing a ticket changes the reply context; history only changes the view. */
const ThreadToolbar = ({
  card,
  selection,
  showAll,
  onShowAllChange,
  onSelectContext,
  busy,
  contextPaused,
  panelOpen,
  phone,
  onTogglePanel,
}: {
  card: ConversationCard;
  selection: ConversationReplySelection;
  showAll: boolean;
  onShowAllChange: (value: boolean) => void;
  onSelectContext: (ticketNum: number | null) => void;
  busy: boolean;
  contextPaused: boolean;
  panelOpen: boolean;
  phone: boolean;
  onTogglePanel: () => void;
}) => {
  const tickets = conversationTickets(card);
  const label =
    selection.mode === "ticket" && selection.ticket
      ? `Заявка ${selection.ticket.num}`
      : selection.mode === "free"
        ? "Без заявки"
        : "Выберите заявку";
  const panelLabel = panelOpen
    ? "Скрыть контакт и заявки"
    : "Показать контакт и заявки";

  return (
    <div className="flex flex-none items-center gap-2 border-b border-border-soft bg-card px-3 py-1.5">
      {card.conversation.kind === "direct" ? (
        <div
          role="group"
          aria-label="Просмотр переписки"
          aria-busy={busy}
          className="flex min-w-0 flex-1 gap-0.5 rounded-lg border border-input p-0.5"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                aria-label={
                  selection.mode === "choose"
                    ? "Выбрать заявку"
                    : `Выбрать заявку: ${label}`
                }
                title={
                  contextPaused
                    ? "Переписка была приостановлена. Выберите заявку для ответа."
                    : undefined
                }
                className={cn(
                  "h-8 min-w-0 flex-1 shrink rounded-md text-sm max-sm:gap-1 max-sm:px-1.5 max-sm:text-xs",
                  !showAll &&
                    "bg-primary/15 text-accent-text hover:bg-primary/20",
                  selection.mode === "choose" && "text-warning-text",
                )}
              >
                <span className="truncate">{label}</span>
                <RiArrowDownSLine aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-96"
              style={{ maxWidth: "calc(100vw - 2rem)" }}
            >
              <DropdownMenuLabel>Выбрать заявку</DropdownMenuLabel>
              {tickets.map((ticket) => {
                const tone = ticketTone(ticket);
                const readOnly = !card.access.reply || !ticket.canReply;
                return (
                  <DropdownMenuItem
                    key={ticket.id}
                    onSelect={() => onSelectContext(ticket.num)}
                    className="items-start gap-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                          Заявка {ticket.num}
                        </span>
                        <TicketStateText
                          tone={readOnly ? "off" : tone.tone}
                          glyph={tone.glyph}
                          size="xs"
                          className="flex-none"
                        >
                          {readOnly ? "Только чтение" : tone.label}
                        </TicketStateText>
                      </span>
                      <span className="mt-1 block text-sm leading-5 font-medium">
                        {ticket.title}
                      </span>
                    </span>
                    {selection.ticket?.id === ticket.id && (
                      <RiCheckLine
                        aria-hidden
                        className="mt-0.5 flex-none text-accent-text"
                      />
                    )}
                  </DropdownMenuItem>
                );
              })}
              {card.access.all && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => onSelectContext(null)}
                    className="gap-2 py-2.5"
                  >
                    <RiChat1Line aria-hidden />
                    Без заявки
                    {selection.mode === "free" && (
                      <RiCheckLine
                        aria-hidden
                        className="ms-auto text-accent-text"
                      />
                    )}
                  </DropdownMenuItem>
                </>
              )}
              {!tickets.length && !card.access.all && (
                <p className="m-0 px-2 py-2 text-sm text-muted-foreground">
                  Нет доступных заявок
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={showAll}
            onClick={() => onShowAllChange(true)}
            className={cn(
              "h-8 min-w-0 flex-1 shrink rounded-md text-sm max-sm:gap-1 max-sm:px-1.5 max-sm:text-xs",
              showAll && "bg-primary/15 text-accent-text hover:bg-primary/20",
            )}
          >
            <RiHistoryLine aria-hidden />
            Вся история
          </Button>
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={panelLabel}
        title={panelLabel}
        aria-expanded={panelOpen}
        aria-haspopup={phone ? "dialog" : undefined}
        onClick={onTogglePanel}
        className={panelOpen ? "bg-accent" : undefined}
      >
        <RiLayoutRightLine aria-hidden />
      </Button>
    </div>
  );
};

export default ThreadToolbar;
