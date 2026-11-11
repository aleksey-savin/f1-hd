import { RiChat1Line, RiCheckLine } from "react-icons/ri";

import FormSheet from "@/components/app/FormSheet";
import { FormHeader } from "@/components/app/FormLayout";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";
import { conversationTickets } from "@/util/conversation-context";

import TicketBlock from "./TicketBlock";

export const FreeDiscussionChoice = ({
  selected,
  disabled = false,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    aria-pressed={selected}
    disabled={disabled}
    onClick={onSelect}
    className={cn(
      "flex w-full cursor-pointer appearance-none items-center gap-3 rounded-lg border bg-transparent px-3 py-3 text-left text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60",
      selected
        ? "border-primary bg-primary/5"
        : "border-border hover:bg-accent",
    )}
  >
    <RiChat1Line
      size={20}
      aria-hidden
      className="flex-none text-muted-foreground"
    />
    <span className="flex-1 text-sm font-semibold">Без заявки</span>
    {selected && (
      <RiCheckLine size={17} aria-hidden className="text-accent-text" />
    )}
  </button>
);

const ReplyContextPicker = ({
  card,
  open,
  onOpenChange,
  onChoose,
  selectedId,
  messageText,
  assigning = false,
  busy = false,
}: {
  card: ConversationCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (ticketNum: number | null) => void;
  selectedId: string | null;
  messageText?: string;
  assigning?: boolean;
  busy?: boolean;
}) => {
  const linked = conversationTickets(card);
  const choices = assigning
    ? [
        ...linked,
        ...card.openTickets
          .filter((ticket) => !linked.some((item) => item.id === ticket.id))
          .map((ticket) => ({ ...ticket, responsibles: [], boundAt: null })),
      ]
    : linked.filter((ticket) => ticket.canReply);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={assigning ? "Заявка сообщения" : "Выбрать тему"}
      size="lg"
    >
      <FormHeader
        title={
          assigning ? "К чему относятся сообщения?" : "По какой теме пишем?"
        }
        subtitle={undefined}
        onHeight={undefined}
      >
        {null}
      </FormHeader>
      {messageText && (
        <p className="mb-4 rounded-lg bg-accent px-3 py-2 text-sm leading-5">
          {messageText}
        </p>
      )}
      {card.access?.all && <FreeDiscussionChoice
        selected={selectedId === "free"}
        disabled={busy}
        onSelect={() => onChoose(null)}
      />}
      <div className="mt-4 grid gap-4 sm:grid-cols-2" aria-busy={busy}>
        {choices.map((ticket) => (
          <TicketBlock
            key={ticket.id}
            card={card}
            ticket={ticket}
            canManage={false}
            onUnbind={() => {}}
            selected={selectedId === ticket.id}
            onSelect={() => {
              if (!busy) onChoose(ticket.num);
            }}
          />
        ))}
      </div>
    </FormSheet>
  );
};
export default ReplyContextPicker;
