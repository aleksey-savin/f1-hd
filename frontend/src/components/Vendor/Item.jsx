import ListRow from "@/components/app/ListRow";
import { monogramFor } from "@/components/app/monogram";

import { plural } from "../../util/plural";

const VendorItem = ({ item }) => {
  const { name, isActive, isMikrotikManagementEnabled, deviceCount = 0 } = item;

  return (
    <ListRow
      item={item}
      itemTitle="vendor"
      monogram={monogramFor(name)}
      title={name}
      dimmed={!isActive}
      meta={
        <>
          {deviceCount > 0
            ? `${deviceCount} ${plural(deviceCount, "устройство", "устройства", "устройств")}`
            : "нет устройств"}
          {isMikrotikManagementEnabled && (
            <>
              {" · "}
              <span className="tw:text-accent-text">управление прошивками</span>
            </>
          )}
        </>
      }
    />
  );
};

export default VendorItem;
