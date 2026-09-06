import { RiBuildingLine, RiPriceTag3Line } from "react-icons/ri";

import ListRow from "@/components/app/ListRow";

import { plural } from "../../util/plural";

/**
 * Строка справочника отвечает на два вопроса: что за список и к чему он
 * привязан. Привязки — чипами под названием, а не колонкой: у одного шаблона их
 * три, у другого ни одной, и колонка постоянной ширины либо обрезала бы, либо
 * пустовала.
 */
const Bind = ({ icon: Icon, children, dashed = false }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-md border border-border-soft px-1.5 py-0.5 text-xs text-muted-foreground ${
      dashed ? "border-dashed" : "bg-secondary"
    }`}
  >
    {Icon && <Icon size={11} className="text-faint" />}
    {children}
  </span>
);

const ChecklistTemplateItem = ({ item }) => {
  const { title, items = [], categories = [], companies = [], isActive } = item;
  const bound = categories.length > 0 || companies.length > 0;

  return (
    <ListRow
      item={item}
      itemTitle="checklistTemplate"
      title={title}
      dimmed={!isActive || !bound}
      meta={
        <span className="mt-1 flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <Bind key={category._id} icon={RiPriceTag3Line}>
              {category.title}
            </Bind>
          ))}
          {companies.map((company) => (
            <Bind key={company._id} icon={RiBuildingLine}>
              {company.alias}
            </Bind>
          ))}
          {categories.length > 0 && companies.length === 0 && (
            <Bind dashed>все компании</Bind>
          )}
          {/* Шаблон без привязок в автоподборе не участвует никогда — иначе он
              повесился бы на все заявки подряд. Выбрать его можно вручную */}
          {!bound && <Bind dashed>без привязок — только вручную</Bind>}
        </span>
      }
      trailing={
        <span className="flex-none text-sm text-muted-foreground tabular-nums">
          {items.length} {plural(items.length, "пункт", "пункта", "пунктов")}
        </span>
      }
    />
  );
};

export default ChecklistTemplateItem;
