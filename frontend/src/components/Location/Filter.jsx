import { useMemo } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import Segmented from "@/components/app/Segmented";

import Select from "../../UI/Select";
import useLocationFilterStore from "../../store/lists/locations";
import { TYPE_LABEL, TYPE_ICON } from "./type-meta";

// Типы для чекбоксов (без «Рабочего места» — им управляет отдельный чип).
const TYPE_KEYS = ["building", "floor", "room", "storage"];

const STATUS_OPTIONS = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные" },
  { value: "inactive", label: "Отключённые" },
];

// Sheet-фильтр расположений (кнопка «Фильтр» на панели списка). Основные
// параметры сущности: тип, статус, общедоступность, подразделение. Компания и
// «Рабочие места» остаются чипами на панели. Применённое дублирует липкая
// плашка бейджей над деревом.
const LocationFilter = () => {
  const filterStore = useLocationFilterStore();
  const originalList = filterStore.originalList || [];

  // Подразделения выбранной компании — из самих расположений (populated).
  const subdivisionOptions = useMemo(() => {
    const byId = new Map();
    for (const location of originalList) {
      for (const sub of location.subdivisions || []) {
        if (sub?._id && !byId.has(String(sub._id))) {
          byId.set(String(sub._id), { _id: sub._id, name: sub.name });
        }
      }
    }
    return [...byId.values()].sort((a, b) =>
      (a.name || "").localeCompare(b.name || ""),
    );
  }, [originalList]);

  const typeFilters = filterStore.typeFilters || [];

  const toggleType = (type) => {
    const next = typeFilters.includes(type)
      ? typeFilters.filter((t) => t !== type)
      : [...typeFilters, type];
    filterStore.updateFilter({ typeFilters: next });
  };

  return (
    <FilterContainer resetFilterHandler={filterStore.resetFilter}>
      <Field label="Статус" className="tw:mb-4">
        <Segmented
          ariaLabel="Статус"
          options={STATUS_OPTIONS}
          value={filterStore.status || "all"}
          onChange={(value) => filterStore.updateFilter({ status: value })}
        />
      </Field>

      <Field label="Тип расположения" className="tw:mb-4">
        <div className="tw:grid tw:gap-0.5">
          {TYPE_KEYS.map((type) => {
            const Icon = TYPE_ICON[type];
            const id = `filter-type-${type}`;
            return (
              <Label
                key={type}
                htmlFor={id}
                className="tw:flex tw:cursor-pointer tw:items-center tw:gap-2.5 tw:rounded-md tw:px-1.5 tw:py-2 tw:text-sm tw:font-normal tw:hover:bg-accent"
              >
                <Checkbox
                  id={id}
                  checked={typeFilters.includes(type)}
                  onCheckedChange={() => toggleType(type)}
                />
                <Icon
                  size={16}
                  aria-hidden
                  className="tw:flex-none tw:text-muted-foreground"
                />
                {TYPE_LABEL[type]}
              </Label>
            );
          })}
        </div>
      </Field>

      <Field label="Подразделение" htmlFor="filter-subdivision" className="tw:mb-4">
        <Select
          id="filter-subdivision"
          placeholder="Любое"
          isClearable
          closeMenuOnSelect
          value={
            subdivisionOptions.find(
              (option) => option._id === filterStore.subdivision?._id,
            ) || null
          }
          options={subdivisionOptions}
          getOptionLabel={(option) => option.name}
          getOptionValue={(option) => option._id}
          onChange={(option) =>
            filterStore.updateFilter({ subdivision: option || null })
          }
        />
      </Field>

      <SwitchField
        id="filter-public"
        checked={!!filterStore.publicOnly}
        onCheckedChange={(checked) =>
          filterStore.updateFilter({ publicOnly: checked })
        }
        label="Только общедоступные"
        hint="Расположения, куда можно перемещать технику из других компаний."
      />
    </FilterContainer>
  );
};

export default LocationFilter;
