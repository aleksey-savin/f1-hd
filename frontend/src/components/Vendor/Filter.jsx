import FilterChip from "@/components/app/FilterChip";

import useVendorFilterStore from "../../store/lists/vendors";

// Чип «Только активные» для строки инструментов списка (согласованный макет
// заменил им сайдбар-фильтр, который для /inventory/vendors и так не
// показывался — путь не входит в белый список сайдбара Root).
const VendorActiveChip = () => {
  const filterStore = useVendorFilterStore();
  const active = filterStore.isActive === true;

  const toggle = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !active,
    });
    filterStore.applyFilter();
  };

  return (
    <FilterChip active={active} onClick={toggle}>
      Только активные
    </FilterChip>
  );
};

export default VendorActiveChip;
