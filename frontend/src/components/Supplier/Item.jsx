import ListRow from "@/components/app/ListRow";

import { formatCalendarDate } from "../../util/format-date";
import { plural } from "../../util/plural";

const money = (value) =>
  value ? `${Number(value).toLocaleString("ru-RU")} ₽` : null;

// Строка справочника: слева — кто это и как связаться, справа — то, ради чего
// сюда заходят: сколько у него куплено и когда в последний раз. Числа — за
// выбранный на панели год (`year`, null — за всё время); сам год в строке не
// повторяется, он написан на чипе.
const SupplierItem = ({ item, year = null }) => {
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
      title={name}
      dimmed={!isActive}
      detailTo={`/inventory/suppliers/${item._id}`}
      meta={contacts || (isActive ? "контакты не указаны" : "отключён")}
      trailing={
        deviceCount > 0 ? (
          <span className="hidden text-right sm:block">
            <span className="block font-semibold tabular-nums">
              {money(totalSpent) || "—"}
            </span>
            <span className="block text-sm text-muted-foreground">
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
              <span className="block text-xs text-faint">
                последняя — {formatCalendarDate(lastPurchaseAt)}
              </span>
            )}
          </span>
        ) : (
          // Пусто в выбранном году — не то же самое, что «никогда не покупали»:
          // дата последней закупки показывает, насколько поставщик остыл.
          <span className="hidden text-right text-sm text-faint sm:block">
            <span className="block">
              {year ? `в ${year} закупок нет` : "закупок нет"}
            </span>
            {lastPurchaseAt && (
              <span className="block text-xs">
                последняя — {formatCalendarDate(lastPurchaseAt)}
              </span>
            )}
          </span>
        )
      }
    />
  );
};

export default SupplierItem;
