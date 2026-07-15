import ListGroupLabel from "@/components/app/ListGroupLabel";

import Item from "./Item";

// Группировка по статусу в языке статус-борда (эталон — «Вендоры»)
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
            className="tw:mt-1.5 tw:border-t tw:border-border-soft"
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
