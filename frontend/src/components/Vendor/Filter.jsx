import FilterContainer from "@/components/app/FilterContainer";
import SwitchField from "@/components/app/SwitchField";

import useVendorFilterStore from "../../store/lists/vendors";

// Sheet-фильтр справочника (кнопка «Фильтр» в строке инструментов).
// Применённые значения показывает липкая плашка бейджей ListWrapper.
const VendorFilter = () => {
  const filterStore = useVendorFilterStore();

  const isActiveToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !filterStore.isActive,
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
    </FilterContainer>
  );
};

export default VendorFilter;
