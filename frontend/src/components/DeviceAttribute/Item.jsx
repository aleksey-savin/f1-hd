import ListRow from "@/components/app/ListRow";
import { monogramFor } from "@/components/app/monogram";

import { valueTypeLabel } from "./value-types";

const DeviceAttributeItem = ({ item }) => {
  const { code, name, valueType, unit, isActive } = item;

  return (
    <ListRow
      item={item}
      itemTitle="deviceAttribute"
      monogram={monogramFor(name)}
      title={name}
      dimmed={!isActive}
      meta={
        <>
          <span className="tw:font-mono tw:text-base">{code}</span>
          {" · "}
          {valueTypeLabel(valueType)}
          {unit && ` (${unit})`}
        </>
      }
    />
  );
};

export default DeviceAttributeItem;
