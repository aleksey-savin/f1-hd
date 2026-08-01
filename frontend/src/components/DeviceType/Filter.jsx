import { useEffect } from "react";

import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Combobox, { MultiCombobox, toOptions } from "@/components/app/Combobox";

import useDeviceTypeFilterStore from "../../store/lists/deviceTypes";
import useDeviceAttributeFilterStore from "../../store/lists/deviceAttributes";
import { KIND_OPTIONS } from "./kinds";

// Одиночный выбор назначения: «Любое» сбрасывает фасет
const KIND_SELECT_OPTIONS = [{ value: "all", label: "Любое" }, ...KIND_OPTIONS];

// Sheet-фильтр справочника (кнопка «Фильтр» в строке инструментов).
// Применённые значения показывает липкая плашка бейджей ListWrapper.
// Выбранные атрибуты храним объектами {_id, name} (гайд: фасеты — объектами,
// иначе бейджу нечем подписаться).
const DeviceTypeFilter = () => {
  const filterStore = useDeviceTypeFilterStore();
  const attributeStore = useDeviceAttributeFilterStore();

  // Каталог атрибутов для мультиселекта — из стора справочника атрибутов
  useEffect(() => {
    if ((attributeStore.originalList || []).length === 0) {
      attributeStore.fetch();
    }
  }, []);

  const attributeOptions = (attributeStore.originalList || []).map(
    (attribute) => ({
      _id: attribute._id,
      name: attribute.name,
    }),
  );

  const isActiveToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !filterStore.isActive,
    });
    filterStore.applyFilter();
  };

  const attributesChangeHandler = (selectedOptions) => {
    filterStore.updateFilter({
      ...filterStore,
      attributes: selectedOptions || [],
    });
    filterStore.applyFilter();
  };

  const kindChangeHandler = (value) => {
    filterStore.updateFilter({
      ...filterStore,
      kind: value && value !== "all" ? value : null,
    });
    filterStore.applyFilter();
  };

  return (
    <FilterContainer resetFilterHandler={filterStore.resetFilter}>
      <SwitchField
        id="filter-is-active"
        checked={!!filterStore.isActive}
        onCheckedChange={isActiveToggleHandler}
        label="Только активные"
      />
      <Field label="Назначение" htmlFor="filter-kind" className="mt-2">
        <Combobox
          id="filter-kind"
          placeholder="Любое"
          value={filterStore.kind || "all"}
          options={KIND_SELECT_OPTIONS}
          onChange={kindChangeHandler}
        />
      </Field>
      <Field
        label="Атрибуты"
        htmlFor="filter-attributes"
        hint="Типы, содержащие все выбранные атрибуты"
        className="mt-2"
      >
        <MultiCombobox
          id="filter-attributes"
          placeholder="Выберите атрибуты..."
          value={(filterStore.attributes || []).map((item) => String(item._id))}
          options={toOptions(attributeOptions, {
            value: (option) => String(option._id),
            label: (option) => option.name,
          })}
          onChange={(ids) =>
            attributesChangeHandler(
              attributeOptions.filter((option) =>
                ids.includes(String(option._id)),
              ),
            )
          }
        />
      </Field>
    </FilterContainer>
  );
};

export default DeviceTypeFilter;
