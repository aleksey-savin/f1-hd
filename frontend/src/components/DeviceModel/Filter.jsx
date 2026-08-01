import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";

import Combobox, { toOptions } from "@/components/app/Combobox";

import useDeviceModelFilterStore from "../../store/lists/deviceModels";

// Sheet-фильтр каталога моделей (кнопка «Фильтр» в строке инструментов).
// Фасеты — «Тип устройства» и «Производитель», одиночным Select. Варианты
// берём из самого каталога (getAll уже populate'ит тип и производителя),
// значения храним объектами {_id, name} (гайд: фасеты — объектами, иначе
// бейджу activeFilters нечем подписаться). Применённое показывает липкая
// плашка бейджей ListWrapper.
const uniqueByIdSorted = (entities) => {
  const byId = new Map();
  for (const entity of entities) {
    if (entity?._id && !byId.has(String(entity._id))) {
      byId.set(String(entity._id), { _id: entity._id, name: entity.name });
    }
  }
  return [...byId.values()].sort((a, b) =>
    (a.name || "").localeCompare(b.name || ""),
  );
};

const DeviceModelFilter = () => {
  const filterStore = useDeviceModelFilterStore();
  const originalList = filterStore.originalList || [];

  const typeOptions = uniqueByIdSorted(
    originalList.map((model) => model.deviceTypeId),
  );
  const vendorOptions = uniqueByIdSorted(
    originalList.map((model) => model.vendorId),
  );

  const typeChangeHandler = (option) => {
    filterStore.updateFilter({ ...filterStore, deviceType: option || null });
    filterStore.applyFilter();
  };

  const vendorChangeHandler = (option) => {
    filterStore.updateFilter({ ...filterStore, vendor: option || null });
    filterStore.applyFilter();
  };

  return (
    <FilterContainer resetFilterHandler={filterStore.resetFilter}>
      <Field label="Тип устройства" htmlFor="filter-device-type">
        <Combobox
          id="filter-device-type"
          placeholder="Любой тип"
          clearable
          clearLabel="Любой тип"
          value={
            filterStore.deviceType?._id
              ? String(filterStore.deviceType._id)
              : null
          }
          options={toOptions(typeOptions, {
            value: (option) => String(option._id),
            label: (option) => option.name,
          })}
          onChange={(id) =>
            typeChangeHandler(
              typeOptions.find((option) => String(option._id) === id) || null,
            )
          }
        />
      </Field>
      <Field label="Производитель" htmlFor="filter-vendor" className="mt-2">
        <Combobox
          id="filter-vendor"
          placeholder="Любой производитель"
          clearable
          clearLabel="Любой производитель"
          value={
            filterStore.vendor?._id ? String(filterStore.vendor._id) : null
          }
          options={toOptions(vendorOptions, {
            value: (option) => String(option._id),
            label: (option) => option.name,
          })}
          onChange={(id) =>
            vendorChangeHandler(
              vendorOptions.find((option) => String(option._id) === id) || null,
            )
          }
        />
      </Field>
    </FilterContainer>
  );
};

export default DeviceModelFilter;
