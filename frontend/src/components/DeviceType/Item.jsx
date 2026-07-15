import ListRow from "@/components/app/ListRow";
import { monogramFor } from "@/components/app/monogram";

import { plural } from "../../util/plural";

const DeviceTypeItem = ({ item }) => {
  const {
    name,
    isActive,
    isComponent,
    isConsumable,
    isPeripheral,
    inventoryPrefix,
    attributes,
  } = item;

  const attributeCount = attributes?.length || 0;
  // Назначение — «включённая способность» типа: показываем акцентом
  const kindFlags = [
    isComponent && "комплектующие",
    isConsumable && "расходники",
    isPeripheral && "периферия",
  ]
    .filter(Boolean)
    .join(" · ");

  const metaParts = [
    attributeCount > 0 &&
      `${attributeCount} ${plural(attributeCount, "атрибут", "атрибута", "атрибутов")}`,
    kindFlags && (
      <span key="kind" className="tw:text-accent-text">
        {kindFlags}
      </span>
    ),
    inventoryPrefix && `префикс ${inventoryPrefix}`,
  ].filter(Boolean);

  return (
    <ListRow
      item={item}
      itemTitle="deviceType"
      monogram={monogramFor(name)}
      title={name}
      dimmed={!isActive}
      meta={
        metaParts.length > 0
          ? metaParts.map((part, index) => (
              <span key={index}>
                {index > 0 && " · "}
                {part}
              </span>
            ))
          : undefined
      }
    />
  );
};

export default DeviceTypeItem;
