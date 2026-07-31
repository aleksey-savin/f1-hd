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
      className="tw:relative tw:flex tw:flex-col tw:gap-0.5 tw:px-4 tw:py-2.5 tw:text-foreground tw:no-underline tw:transition-colors tw:before:absolute tw:before:top-0 tw:before:right-4 tw:before:left-4 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden tw:hover:bg-accent/60 tw:hover:text-foreground tw:md:flex-row tw:md:items-center tw:md:gap-3 tw:md:px-5"
    >
      {/* мобайл: номер и статус одной строкой над темой */}
      <div className="tw:flex tw:items-baseline tw:gap-2 tw:text-xs tw:text-muted-foreground tw:tabular-nums tw:md:hidden">
        <span>№ {ticket.num}</span>
        <TicketStateText tone={tone} className="tw:ms-auto tw:text-xs">
          {label}
        </TicketStateText>
      </div>

      <div className="tw:hidden tw:w-16 tw:flex-none tw:text-sm tw:font-medium tw:text-muted-foreground tw:tabular-nums tw:md:block">
        {ticket.num}
      </div>

      <div className="tw:min-w-0 tw:flex-1">
        <div className="tw:truncate tw:text-sm tw:font-medium">
          {ticket.title || "Без темы"}
        </div>
        {meta && (
          <div className="tw:truncate tw:text-sm tw:text-muted-foreground">
            {meta}
          </div>
        )}
      </div>

      <div className="tw:hidden tw:w-32 tw:flex-none tw:md:block">
        <TicketStateText tone={tone}>{label}</TicketStateText>
      </div>

      {trailing != null && (
        <div className="tw:flex-none tw:text-sm tw:text-muted-foreground tw:tabular-nums tw:md:text-right">
          {trailing}
        </div>
      )}
    </Link>
  );
};

export default TicketRow;
