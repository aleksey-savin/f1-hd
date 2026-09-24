import { Link } from "react-router";

import { useCrumbFrom } from "@/components/app/Crumbs";
import { cn } from "@/lib/utils";
import { plural } from "../../util/plural";
import { TicketStateText, ticketTone } from "../Ticket/ticket-state";

/**
 * Компактная строка заявки для главной: номер · тема + мета · статус · правый
 * слот.
 *
 * Своя, а не `Ticket/Row`: тот несёт режим выбора, «⋯»-меню и права — целый
 * инструмент списка, которого на лендинге нет. И не `Ticket/ArchiveItem`: тот
 * говорит «закрыта …», а здесь строка живая.
 *
 * Правый слот (`trailing`) — там, где у блока свой ответ на «что с ней не
 * так»: возраст, время без движения, кнопка «Взять». Поэтому он проп, а не
 * колонка: у трёх блоков сотрудника три разных правых края. На телефоне слот
 * встаёт в первую строку после номера: своей строкой под метой он читался
 * одиноким хвостом — четвёртой строкой похожего кегля.
 */
const TicketRow = ({ ticket, meta, trailing, unread }) => {
  const { label, tone } = ticketTone(ticket);
  const fromState = useCrumbFrom("Главная");
  // Непрочитанное — те же знаки, что у строки списка заявок (Ticket/Row):
  // точка у номера, тема полужирным, «N новых» первым в мете
  const unseen = Boolean(unread?.isUnseen);
  const newComments = unread?.newComments ?? 0;
  const unseenDot = (
    <span
      aria-hidden
      className="me-1.5 inline-block size-1.5 rounded-full bg-primary align-middle"
    />
  );

  return (
    <Link
      to={`/tickets/${ticket.num}`}
      state={fromState}
      className="relative flex flex-col gap-0.5 px-4 py-2.5 text-foreground no-underline transition-colors before:absolute before:top-0 before:right-4 before:left-4 before:h-px before:bg-border-soft first:before:hidden hover:bg-accent/60 hover:text-foreground md:flex-row md:items-center md:gap-3 md:px-5"
    >
      {/* мобайл: номер, правый слот и состояние одной строкой над темой */}
      <div className="flex items-baseline gap-2 text-xs text-muted-foreground tabular-nums md:hidden">
        <span className="truncate">
          {unseen && unseenDot}
          {ticket.num}
          {trailing != null && <> · {trailing}</>}
        </span>
        <TicketStateText tone={tone} className="ms-auto flex-none text-xs">
          {label}
        </TicketStateText>
      </div>

      <div className="hidden w-16 flex-none text-sm font-medium text-muted-foreground tabular-nums md:block">
        {unseen && unseenDot}
        {ticket.num}
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm",
            unseen ? "font-semibold" : "font-medium",
          )}
        >
          {ticket.title || "Без темы"}
        </div>
        {(meta || newComments > 0) && (
          <div className="truncate text-sm text-muted-foreground">
            {newComments > 0 && (
              <>
                <span className="font-semibold text-accent-text">
                  {newComments} {plural(newComments, "новый", "новых", "новых")}
                </span>
                {meta && " · "}
              </>
            )}
            {meta}
          </div>
        )}
      </div>

      <div className="hidden w-32 flex-none md:block">
        <TicketStateText tone={tone}>{label}</TicketStateText>
      </div>

      {trailing != null && (
        <div className="hidden flex-none text-sm text-muted-foreground tabular-nums md:block md:text-right">
          {trailing}
        </div>
      )}
    </Link>
  );
};

export default TicketRow;
