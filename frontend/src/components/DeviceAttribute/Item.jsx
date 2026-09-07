import { useState } from "react";

import { RiPriceTag3Line } from "react-icons/ri";

import ListRow from "@/components/app/ListRow";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import useDeviceTypeFilterStore from "@/store/lists/deviceTypes";

import { valueTypeLabel } from "./value-types";
import { typesOfAttribute } from "./device-type-links";
import DeviceTypesDialog from "./DeviceTypesDialog";

// Строка справочника атрибутов: имя · мета (тип данных, единица и — у
// списочных типов — сами варианты значений) · колонка типов устройств, в
// которых атрибут используется. Кода в строке нет: он служебный, а поиск по
// нему остался в сторе. Варианты идут текстом, продолжением меты, а не
// облаком пилюль — у строки списка мета одна строка, и облако рвало бы
// одинаковую высоту строк.
const SELECT_TYPES = ["select", "multiselect"];

// Имён типов до «+N»: две штуки помещаются в колонку при любых названиях.
const NAMES_SHOWN = 2;

const NO_TYPES = "Не в одном типе";

const DeviceAttributeItem = ({ item }) => {
  const { name, valueType, unit, options, isActive } = item;

  const [typesOpen, setTypesOpen] = useState(false);
  const deviceTypes = useDeviceTypeFilterStore(
    (state) => state.originalList || [],
  );

  const optionLabels = SELECT_TYPES.includes(valueType)
    ? (options || [])
        .map((option) => option.label || option.value)
        .filter(Boolean)
    : [];

  const typeNames = typesOfAttribute(deviceTypes, item._id).map(
    (deviceType) => deviceType.name,
  );
  const shownNames = typeNames.slice(0, NAMES_SHOWN).join(", ");
  const restCount = typeNames.length - NAMES_SHOWN;
  const allNames = typeNames.join(", ");

  // Десктоп: колонка сразу за метой (её начало держит потолок ширины у
  // ListRow) — имена типов встают столбцом и читаются сверху вниз, а мета
  // остаётся местом вариантов значений.
  const typesColumn =
    typeNames.length > 0 ? (
      <div
        title={allNames}
        className="hidden min-w-0 flex-1 items-baseline gap-1.5 text-sm text-muted-foreground md:flex"
      >
        <span className="min-w-0 truncate">{shownNames}</span>
        {restCount > 0 && (
          <span className="flex-none text-faint tabular-nums">
            +{restCount}
          </span>
        )}
      </div>
    ) : (
      <div className="hidden min-w-0 flex-1 truncate text-sm text-faint md:block">
        {NO_TYPES}
      </div>
    );

  return (
    <>
      <ListRow
        item={item}
        itemTitle="deviceAttribute"
        title={name}
        dimmed={!isActive}
        meta={
          <>
            <span className="block truncate">
              {valueTypeLabel(valueType)}
              {unit && ` (${unit})`}
              {optionLabels.length > 0 && ` · ${optionLabels.join(", ")}`}
            </span>
            {/* Мобайл: колонке нет места — типы идут третьей строкой, у всех
                строк одинаково (у непривязанного атрибута тут заглушка) */}
            <span
              className={cn(
                "block truncate md:hidden",
                typeNames.length === 0 && "text-faint",
              )}
            >
              {typeNames.length > 0
                ? `${shownNames}${restCount > 0 ? ` +${restCount}` : ""}`
                : NO_TYPES}
            </span>
          </>
        }
        column={typesColumn}
        extraActions={
          <DropdownMenuItem onSelect={() => setTypesOpen(true)}>
            <RiPriceTag3Line /> Привязать к типам
          </DropdownMenuItem>
        }
      />
      <DeviceTypesDialog
        attribute={item}
        open={typesOpen}
        onOpenChange={setTypesOpen}
      />
    </>
  );
};

export default DeviceAttributeItem;
