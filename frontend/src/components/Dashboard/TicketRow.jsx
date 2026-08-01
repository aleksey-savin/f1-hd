import { Link } from "react-router";

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
 * колонка: у трёх блоков сотрудника три разных правых края.
 */
const TicketRow = ({ ticket, meta, trailing }) => {
  const { label, tone } = ticketTone(ticket);

  return (
    <Link
      to={`/tickets/${ticket.num}`}
      className="relative flex flex-col gap-0.5 px-4 py-2.5 text-foreground no-underline transition-colors before:absolute before:top-0 before:right-4 before:left-4 before:h-px before:bg-border-soft first:before:hidden hover:bg-accent/60 hover:text-foreground md:flex-row md:items-center md:gap-3 md:px-5"
    >
      {/* мобайл: номер и статус одной строкой над темой */}
      <div className="flex items-baseline gap-2 text-xs text-muted-foreground tabular-nums md:hidden">
        <span>№ {ticket.num}</span>
        <TicketStateText tone={tone} className="ms-auto text-xs">
          {label}
        </TicketStateText>
      </div>

      <div className="hidden w-16 flex-none text-sm font-medium text-muted-foreground tabular-nums md:block">
        {ticket.num}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {ticket.title || "Без темы"}
        </div>
        {meta && (
          <div className="truncate text-sm text-muted-foreground">{meta}</div>
        )}
      </div>

      <div className="hidden w-32 flex-none md:block">
        <TicketStateText tone={tone}>{label}</TicketStateText>
      </div>

      {trailing != null && (
        <div className="flex-none text-sm text-muted-foreground tabular-nums md:text-right">
          {trailing}
        </div>
      )}
    </Link>
  );
};

export default TicketRow;
