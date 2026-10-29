import ListRow from "@/components/app/ListRow";

import { plural } from "../../util/plural";

const DeviceTypeItem = ({ item }) => {
  const { name, isActive, inventoryPrefix, attributes } = item;

  const attributeCount = attributes?.length || 0;
  // Назначения в мете нет: список уже разложен по нему сегментом, и у всех
  // строк раздела оно одно
  const metaParts = [
    attributeCount > 0 &&
      `${attributeCount} ${plural(attributeCount, "атрибут", "атрибута", "атрибутов")}`,
    inventoryPrefix && `префикс ${inventoryPrefix}`,
  ].filter(Boolean);

  return (
    <ListRow
      item={item}
      itemTitle="deviceType"
      detailTo={`/inventory/device-types/${item._id}`}
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
