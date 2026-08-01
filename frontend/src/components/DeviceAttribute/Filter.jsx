import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Combobox from "@/components/app/Combobox";

import useDeviceAttributeFilterStore from "../../store/lists/deviceAttributes";
import { VALUE_TYPES } from "./value-types";

const TYPE_OPTIONS = [{ value: "all", label: "Все типы" }, ...VALUE_TYPES];

// Sheet-фильтр справочника (кнопка «Фильтр» в строке инструментов).
// Применённые значения показывает липкая плашка бейджей ListWrapper.
const DeviceAttributeFilter = () => {
  const filterStore = useDeviceAttributeFilterStore();

  const isActiveToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !filterStore.isActive,
    });
    filterStore.applyFilter();
  };

  const valueTypeChangeHandler = (value) => {
    filterStore.updateFilter({
      ...filterStore,
      valueType: value ?? "all",
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
      <Field label="Тип данных" htmlFor="filter-value-type" className="mt-2">
        <Combobox
          id="filter-value-type"
          placeholder="Все типы"
          value={filterStore.valueType || "all"}
          options={TYPE_OPTIONS}
          onChange={valueTypeChangeHandler}
        />
      </Field>
    </FilterContainer>
  );
};

export default DeviceAttributeFilter;
