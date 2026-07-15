import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Select from "../../UI/Select";
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

  const valueTypeChangeHandler = (option) => {
    filterStore.updateFilter({
      ...filterStore,
      valueType: option?.value ?? "all",
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
      <Field label="Тип данных" htmlFor="filter-value-type" className="tw:mt-2">
        <Select
          id="filter-value-type"
          placeholder="Все типы"
          closeMenuOnSelect
          value={TYPE_OPTIONS.filter(
            (option) => option.value === (filterStore.valueType || "all"),
          )}
          options={TYPE_OPTIONS}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={valueTypeChangeHandler}
        />
      </Field>
    </FilterContainer>
  );
};

export default DeviceAttributeFilter;
