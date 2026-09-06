import ListRow from "@/components/app/ListRow";

import { valueTypeLabel } from "./value-types";

const DeviceAttributeItem = ({ item }) => {
  const { code, name, valueType, unit, isActive } = item;

  return (
    <ListRow
      item={item}
      itemTitle="deviceAttribute"
      title={name}
      dimmed={!isActive}
      meta={
        <>
          <span className="font-mono text-base">{code}</span>
          {" · "}
          {valueTypeLabel(valueType)}
          {unit && ` (${unit})`}
        </>
      }
    />
  );
};

export default DeviceAttributeItem;
