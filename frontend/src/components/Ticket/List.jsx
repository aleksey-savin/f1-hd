import TicketRow from "./Row";

// Список заявок для мест без ListWrapper: карточка и шторка главной. Только
// чтение — ни выделения, ни массовых действий: на главной заявки смотрят, а
// работают с ними в разделе.
//
// Строка — та же, что в разделе (одна информация — один вид), поэтому панель
// повторяет только контейнер списка.
const TicketsList = ({ items = [] }) => {
  if (items.length === 0) {
    return (
      <p className="tw:my-4 tw:text-center tw:text-sm tw:text-muted-foreground">
        Заявок нет
      </p>
    );
  }

  return (
    <div className="tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card tw:pb-1.5">
      {items.map((ticket) => (
        <TicketRow key={ticket._id} ticket={ticket} />
      ))}
    </div>
  );
};

export default TicketsList;
