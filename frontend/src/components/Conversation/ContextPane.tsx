import type { ReactNode } from "react";
import { RiAddLine, RiCheckLine } from "react-icons/ri";

import { SubLabel } from "@/components/app/Panel";
import { monogramFor } from "@/components/app/monogram";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ConversationCard,
  ConversationReplySelection,
} from "@/types/conversation";
import { counterpartHandle, networkLabel } from "@/util/conversation-format";
import { conversationTickets } from "@/util/conversation-context";

import ContactBlock from "./ContactBlock";
import ContactChannelRow from "./ContactChannelRow";
import OpenTickets from "./OpenTickets";
import { FreeDiscussionChoice } from "./ReplyContextPicker";
import TicketBlock from "./TicketBlock";
import WhoIsThis from "./WhoIsThis";

export type ContextHandlers = {
  onBind: (ticketNum: number) => void;
  onUnbind: (ticketNum?: number) => void;
  onAssign: (userId: string | null) => void;
  onLinked: () => void;
};

const Participants = ({ card }: { card: ConversationCard }) => (
  <>
    <SubLabel className="mt-5" count={card.participants.length}>
      Участники
    </SubLabel>
    {card.participants.map((person, index) => (
      <div
        key={person.identityId}
        className={cn(
          "flex items-center gap-2.5 py-2",
          index > 0 && "border-t border-border-soft",
        )}
      >
        <span
          aria-hidden
          className="grid size-7 flex-none place-items-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border"
        >
          {monogramFor(person.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{person.name}</div>
          {!person.userId && (
            <div className="truncate text-xs text-warning-text">
              не связан с пользователем портала
            </div>
          )}
        </div>
      </div>
    ))}
  </>
);

/** Same context and choices in the desktop pane and the mobile context sheet. */
const ContextPane = ({
  card,
  canManage,
  big = false,
  now,
  timeZone,
  handlers,
  selection,
  onSelectContext,
  onCreateTicket,
  onChooseContext,
  actions,
  decision,
  contextBusy = false,
  contextPaused = false,
}: {
  card: ConversationCard;
  canManage: boolean;
  big?: boolean;
  now: Date;
  timeZone: string;
  handlers: ContextHandlers;
  selection: ConversationReplySelection;
  onSelectContext: (ticketNum: number | null) => void;
  onCreateTicket: () => void;
  onChooseContext: () => void;
  actions?: ReactNode;
  decision?: ReactNode;
  contextBusy?: boolean;
  contextPaused?: boolean;
}) => {
  const { conversation } = card;
  const linked = conversationTickets(card);
  const otherTickets = {
    ...card,
    openTickets: card.openTickets.filter(
      (ticket) => !linked.some((item) => item.id === ticket.id),
    ),
  };
  return (
    <>
      <div className="mb-4 border-b border-border-soft pb-3">
        {card.contact ? (
          <ContactBlock card={card} big={big} actions={actions} />
        ) : (
          <>
            <ContactChannelRow
              channel={conversation.network}
              label={networkLabel(conversation.network)}
              value={
                counterpartHandle(card.counterpart) ||
                networkLabel(conversation.network)
              }
              current
              big={big}
              actions={actions}
            />
            {conversation.kind !== "group" && (
              <WhoIsThis
                card={card}
                canManage={canManage}
                onLinked={handlers.onLinked}
                showIdentity={false}
              />
            )}
          </>
        )}
      </div>
      {conversation.kind === "group" ? (
        <Participants card={card} />
      ) : (
        <>
          {decision && <div className="mb-4">{decision}</div>}
          {card.access?.all && card.access?.reply && <FreeDiscussionChoice
            selected={selection.mode === "free"}
            disabled={contextBusy}
            onSelect={() => onSelectContext(null)}
          />}
          {canManage && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 w-full"
              onClick={onCreateTicket}
            >
              <RiAddLine />
              Создать заявку
            </Button>
          )}
          {card.access?.reply && selection.mode === "choose" && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-warning-text">
              <span>
                {contextPaused
                  ? "Переписка была приостановлена"
                  : "Выберите тему для ответа"}
              </span>
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={onChooseContext}
              >
                Выбрать
              </Button>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-3" aria-busy={contextBusy}>
            {linked.map((ticket) => (
              <TicketBlock
                key={ticket.id}
                card={card}
                ticket={ticket}
                canManage={canManage}
                now={now}
                timeZone={timeZone}
                onUnbind={() => handlers.onUnbind(ticket.num)}
                selected={selection.ticket?.id === ticket.id}
                onSelect={() => {
                  if (!contextBusy) onSelectContext(ticket.num);
                }}
              />
            ))}
          </div>
          <OpenTickets
            card={otherTickets}
            canBind={canManage && conversation.kind === "direct"}
            onBind={handlers.onBind}
          />
          {!linked.length && selection.mode === "free" && (
            <span className="sr-only">
              <RiCheckLine />
              Диалог без заявки
            </span>
          )}
        </>
      )}
    </>
  );
};
export default ContextPane;
