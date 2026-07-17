import ListRow from "@/components/app/ListRow";
import { RiComputerLine } from "react-icons/ri";

import { photoUrl } from "../Devices/Photos";
import { plural } from "../../util/plural";

// Строка каталога моделей: плитка — фото из каталога, иначе иконка устройства;
// заголовок «Производитель + модель», мета «Тип · N конфигураций» (у
// расходников — «Тип · совместимо: N моделей»). Клик по строке → карточка.
const DeviceModelItem = ({ item }) => {
  const {
    name,
    deviceTypeId,
    vendorId,
    compatibleWithModelIds,
    photos,
    configurationsCount,
  } = item;

  const typeName = deviceTypeId?.name;
  const isConsumable = deviceTypeId?.isConsumable;

  // «Производитель + модель»; у безымянной модели — только производитель
  const displayTitle =
    [vendorId?.name, name].filter(Boolean).join(" ") || "Без названия";

  const thumbSrc = photos?.[0] ? photoUrl(photos[0]) : undefined;

  const compatibleCount = compatibleWithModelIds?.length || 0;
  const configCount = configurationsCount || 0;

  // У расходников значима совместимость, у остальных — число конфигураций
  const detail = isConsumable
    ? compatibleCount > 0
      ? `совместимо: ${compatibleCount} ${plural(compatibleCount, "модель", "модели", "моделей")}`
      : null
    : configCount > 0
      ? `${configCount} ${plural(configCount, "конфигурация", "конфигурации", "конфигураций")}`
      : "без конфигураций";

  const meta = [typeName, detail].filter(Boolean).join(" · ");

  return (
    <ListRow
      // title в item — чтобы диалог удаления подписался именем модели
      item={{ ...item, title: displayTitle }}
      itemTitle="deviceModel"
      thumbSrc={thumbSrc}
      monogram={<RiComputerLine size={26} />}
      title={displayTitle}
      meta={meta || undefined}
      detailTo={`/inventory/device-models/${item._id}`}
    />
  );
};

export default DeviceModelItem;
