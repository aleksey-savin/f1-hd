import ListGroupLabel from "@/components/app/ListGroupLabel";

import Item from "./Item";

/**
 * Группировка по тому, участвует ли шаблон в автоподборе: привязанный приедет
 * в заявку сам, без привязок — только ручным выбором. Это и есть главный
 * вопрос к строке справочника.
 */
const ChecklistTemplateList = ({ items = [] }) => {
  const auto = items.filter(
    (item) =>
      item.isActive &&
      ((item.categories?.length ?? 0) > 0 || (item.companies?.length ?? 0) > 0),
  );
  const manual = items.filter((item) => !auto.includes(item));

  return (
    <>
      {auto.length > 0 && (
        <ListGroupLabel
          label="Применяются автоматически"
          count={auto.length}
          tone="on"
        />
      )}
      <div className="appear-children">
        {auto.map((item) => (
          <Item key={item._id} item={item} />
        ))}
      </div>

      {manual.length > 0 && (
        <>
          <ListGroupLabel
            label="Только вручную"
            count={manual.length}
            tone="off"
            className="mt-1.5 border-t border-border-soft"
          />
          <div className="appear-children">
            {manual.map((item) => (
              <Item key={item._id} item={item} />
            ))}
          </div>
        </>
      )}
    </>
  );
};

export default ChecklistTemplateList;
