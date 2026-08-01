import ListGroupLabel from "@/components/app/ListGroupLabel";

import Item from "./Item";

// Плоский список (по умолчанию) или группировка по подразделению (когда в
// фильтре выбрана одна компания). Группировка приходит уже отсортированной с
// сервера; здесь только раскладываем по заголовкам-подразделениям.
const NO_SUBDIVISION = "__none__";

const List = ({ items = [], grouped = false }) => {
  if (!grouped) {
    return (
      <>
        {items.map((item) => (
          <Item key={item._id} item={item} />
        ))}
      </>
    );
  }

  const groups = new Map();
  for (const item of items) {
    const key = item.subdivisionName || NO_SUBDIVISION;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const entries = [...groups.entries()].sort((a, b) => {
    if (a[0] === NO_SUBDIVISION) return 1;
    if (b[0] === NO_SUBDIVISION) return -1;
    return a[0].localeCompare(b[0]);
  });

  return (
    <>
      {entries.map(([key, groupItems], index) => (
        <div key={key}>
          <ListGroupLabel
            label={key === NO_SUBDIVISION ? "Без подразделения" : key}
            count={groupItems.length}
            tone={key === NO_SUBDIVISION ? "off" : "on"}
            className={index > 0 ? "mt-1.5 border-t border-border-soft" : ""}
          />
          {groupItems.map((item) => (
            <Item key={item._id} item={item} />
          ))}
        </div>
      ))}
    </>
  );
};

export default List;
