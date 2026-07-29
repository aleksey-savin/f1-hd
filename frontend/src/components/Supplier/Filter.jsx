import FilterContainer from "@/components/app/FilterContainer";
import SwitchField from "@/components/app/SwitchField";

import useSupplierFilterStore from "../../store/lists/suppliers";

// Sheet-фильтр справочника; применённое показывает плашка бейджей ListWrapper.
const SupplierFilter = () => {
  const filterStore = useSupplierFilterStore();

  return (
    <FilterContainer resetFilterHandler={filterStore.resetFilter}>
      <SwitchField
        id="supplier-filter-active"
        checked={Boolean(filterStore.isActive)}
        onCheckedChange={() =>
          filterStore.updateFilter({ isActive: !filterStore.isActive })
        }
        label="Только активные"
        hint="Отключённые остаются в истории закупок, но не предлагаются в форме устройства."
      />
    </FilterContainer>
  );
};

export default SupplierFilter;
