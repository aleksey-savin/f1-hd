import ListGroupLabel from "@/components/app/ListGroupLabel";

import Item from "./Item";

// Список по согласованному макету: группировка по статусу в языке
// статус-борда («Активные · 9 / Отключённые · 3»), без бейджей в строках.
const List = ({ items = [] }) => {
  const active = items.filter((item) => item.isActive);
  const disabled = items.filter((item) => !item.isActive);

  return (
    <>
      {active.length > 0 && (
        <ListGroupLabel label="Активные" count={active.length} tone="on" />
      )}
      <div>
        {active.map((item) => (
          <Item key={item._id} item={item} />
        ))}
      </div>
      {disabled.length > 0 && (
        <>
          <ListGroupLabel
            label="Отключённые"
            count={disabled.length}
            tone="off"
            className="tw:border-t tw:border-border-soft tw:mt-1.5"
          />
          <div>
            {disabled.map((item) => (
              <Item key={item._id} item={item} />
            ))}
          </div>
        </>
      )}
    </>
  );
};

export default List;
