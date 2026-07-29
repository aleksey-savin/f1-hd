import ListRow from "@/components/app/ListRow";
import { monogramFor } from "@/components/app/monogram";

import { formatCalendarDate } from "../../util/format-date";
import { plural } from "../../util/plural";

const money = (value) =>
  value ? `${Number(value).toLocaleString("ru-RU")} ₽` : null;

// Строка справочника: слева — кто это и как связаться, справа — то, ради чего
// сюда заходят: сколько у него куплено и когда в последний раз.
const SupplierItem = ({ item }) => {
  const {
    name,
    isActive,
    phone,
    email,
    website,
    deviceCount = 0,
    deliveryCount = 0,
    totalSpent = 0,
    lastPurchaseAt,
  } = item;

  const contacts = [phone, email, website].filter(Boolean).join(" · ");

  return (
    <ListRow
      item={item}
      itemTitle="supplier"
      monogram={monogramFor(name)}
      title={name}
      dimmed={!isActive}
      detailTo={`/inventory/suppliers/${item._id}`}
      meta={contacts || (isActive ? "контакты не указаны" : "отключён")}
      trailing={
        deviceCount > 0 ? (
          <span className="tw:hidden tw:text-right tw:sm:block">
            <span className="tw:block tw:font-semibold tw:tabular-nums">
              {money(totalSpent) || "—"}
            </span>
            <span className="tw:block tw:text-sm tw:text-muted-foreground">
              {deviceCount}{" "}
              {plural(deviceCount, "устройство", "устройства", "устройств")}
              {deliveryCount > 0 && (
                <>
                  {" · "}
                  {deliveryCount}{" "}
                  {plural(deliveryCount, "поставка", "поставки", "поставок")}
                </>
              )}
            </span>
            {lastPurchaseAt && (
              <span className="tw:block tw:text-xs tw:text-faint">
                последняя — {formatCalendarDate(lastPurchaseAt)}
              </span>
            )}
          </span>
        ) : (
          <span className="tw:hidden tw:text-sm tw:text-faint tw:sm:block">
            закупок нет
          </span>
        )
      }
    />
  );
};

export default SupplierItem;
