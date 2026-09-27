import { RiGroupLine } from "react-icons/ri";

import { SubLabel } from "@/components/app/Panel";
import { monogramFor } from "@/components/app/monogram";
import { cn } from "@/lib/utils";
import type { ConversationCard } from "@/types/conversation";
import { networkLabel } from "@/util/conversation-format";

import AssigneePicker from "./AssigneePicker";
import ContactBlock from "./ContactBlock";
import OpenTickets from "./OpenTickets";
import TicketBlock from "./TicketBlock";
import WhoIsThis from "./WhoIsThis";

/**
 * Колонка «Контакт и заявка» справа от переписки (канва A1, C2) и её же
 * содержимое в шторке телефона (B3, `big`):
 *   • собеседник связан — карточка с каналами, привязанная заявка, открытые
 *     заявки компании, ответственный за диалог;
 *   • не связан — «Кто это?»;
 *   • группа (выбор сообщений — этап P2) — участники и ответственный.
 */
export type ContextHandlers = {
  onBind: (ticketNum: number) => void;
  onUnbind: () => void;
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
              не связан с пользователем HD
            </div>
          )}
        </div>
      </div>
    ))}
  </>
);

const ContextPane = ({
  card,
  canManage,
  big = false,
  now,
  timeZone,
  handlers,
}: {
  card: ConversationCard;
  canManage: boolean;
  big?: boolean;
  now: Date;
  timeZone: string;
  handlers: ContextHandlers;
}) => {
  const { conversation } = card;
  const assignee = (
    <>
      <SubLabel className="mt-5">Ответственный за диалог</SubLabel>
      <AssigneePicker
        assignee={conversation.assignee}
        disabled={!canManage}
        onChange={handlers.onAssign}
      />
    </>
  );

  if (conversation.kind === "group") {
    return (
      <>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-11 flex-none place-items-center rounded-[25%] bg-accent text-muted-foreground inset-ring inset-ring-border"
          >
            <RiGroupLine size={22} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-base leading-6 font-semibold">
              {conversation.title}
            </div>
            <div className="truncate text-sm text-muted-foreground">
              {networkLabel(conversation.network)} · группа
            </div>
          </div>
        </div>
        <Participants card={card} />
        {assignee}
      </>
    );
  }

  if (!card.contact) {
    // Собеседник не опознан — заявка и ответственный за диалог всё равно
    // могли появиться (личный чат привязали заявкой, диалог назначили) и
    // рисуются под «Кто это?» так же, как у опознанного собеседника (канва
    // A1): те же пропсы и те же эйбрау
    return (
      <>
        <WhoIsThis card={card} canManage={canManage} onLinked={handlers.onLinked} />
        {conversation.ticket && (
          <>
            <SubLabel className="mt-5">Заявка</SubLabel>
            <TicketBlock
              card={card}
              canManage={canManage}
              now={now}
              timeZone={timeZone}
              onUnbind={handlers.onUnbind}
            />
          </>
        )}
        {assignee}
      </>
    );
  }

  return (
    <>
      <ContactBlock card={card} big={big} />
      {conversation.ticket && (
        <>
          <SubLabel className="mt-5">Заявка</SubLabel>
          <TicketBlock
            card={card}
            canManage={canManage}
            now={now}
            timeZone={timeZone}
            onUnbind={handlers.onUnbind}
          />
        </>
      )}
      <OpenTickets
        card={card}
        canBind={canManage && !conversation.ticket && conversation.kind === "direct"}
        onBind={handlers.onBind}
      />
      {assignee}
    </>
  );
};

export default ContextPane;
