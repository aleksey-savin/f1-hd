import ListGroupLabel from "@/components/app/ListGroupLabel";

import Item from "./Item";

// Список регламентов, сгруппированный по статусу (язык статус-борда: активные —
// бирюзой, на паузе — гаснут). Единственная непустая группа — без метки
// (гайд: заголовок с одной группой не несёт информации).
const List = ({ items = [] }) => {
  const groups = [
    {
      key: "active",
      label: "Активные",
      tone: "on",
      rows: items.filter((item) => item.isActive),
    },
    {
      key: "paused",
      label: "На паузе",
      tone: "off",
      rows: items.filter((item) => !item.isActive),
    },
  ].filter((group) => group.rows.length > 0);

  const single = groups.length <= 1;

  return (
    <>
      {groups.map((group, index) => (
        <div key={group.key}>
          {!single && (
            <ListGroupLabel
              label={group.label}
              count={group.rows.length}
              tone={group.tone}
              className={
                index > 0
                  ? "tw:mt-1.5 tw:border-t tw:border-border-soft"
                  : undefined
              }
            />
          )}
          <div>
            {group.rows.map((item) => (
              <Item key={item._id} item={item} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
};

export default List;
