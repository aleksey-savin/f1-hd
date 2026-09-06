import ListRow from "@/components/app/ListRow";

import { plural } from "../../util/plural";

const VendorItem = ({ item }) => {
  const { name, isActive, isMikrotikManagementEnabled, deviceCount = 0 } = item;

  return (
    <ListRow
      item={item}
      itemTitle="vendor"
      title={name}
      dimmed={!isActive}
      detailTo={`/inventory/vendors/${item._id}`}
      meta={
        <>
          {deviceCount > 0
            ? `${deviceCount} ${plural(deviceCount, "устройство", "устройства", "устройств")}`
            : "нет устройств"}
          {isMikrotikManagementEnabled && (
            <>
              {" · "}
              <span className="text-accent-text">управление прошивками</span>
            </>
          )}
        </>
      }
    />
  );
};

export default VendorItem;
