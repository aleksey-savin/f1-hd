import ListGroupLabel from "@/components/app/ListGroupLabel";

import Item from "./Item";

// Список шаблонов, сгруппированный по категории (порядок внутри группы задаёт
// сортировка стора). Единственная группа — без метки (гайд: заголовок с одной
// группой не несёт информации).
const List = ({ items = [] }) => {
  const groups = new Map();
  for (const item of items) {
    const key = item.categoryId?.title ?? "Без категории";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const titles = [...groups.keys()].sort((a, b) => {
    if (a === "Без категории") return 1;
    if (b === "Без категории") return -1;
    return a.localeCompare(b);
  });

  const single = titles.length <= 1;

  return (
    <>
      {titles.map((title, index) => (
        <div key={title}>
          {!single && (
            <ListGroupLabel
              label={title}
              count={groups.get(title).length}
              className={
                index > 0
                  ? "tw:mt-1.5 tw:border-t tw:border-border-soft"
                  : undefined
              }
            />
          )}
          <div>
            {groups.get(title).map((item) => (
              <Item key={item._id} item={item} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
};

export default List;
