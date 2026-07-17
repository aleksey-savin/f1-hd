import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";

import Select from "../../UI/Select";
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
        <Select
          id="filter-device-type"
          placeholder="Любой тип"
          isClearable
          closeMenuOnSelect
          value={
            typeOptions.find(
              (option) => option._id === filterStore.deviceType?._id,
            ) || null
          }
          options={typeOptions}
          getOptionLabel={(option) => option.name}
          getOptionValue={(option) => option._id}
          onChange={typeChangeHandler}
        />
      </Field>
      <Field
        label="Производитель"
        htmlFor="filter-vendor"
        className="tw:mt-2"
      >
        <Select
          id="filter-vendor"
          placeholder="Любой производитель"
          isClearable
          closeMenuOnSelect
          value={
            vendorOptions.find(
              (option) => option._id === filterStore.vendor?._id,
            ) || null
          }
          options={vendorOptions}
          getOptionLabel={(option) => option.name}
          getOptionValue={(option) => option._id}
          onChange={vendorChangeHandler}
        />
      </Field>
    </FilterContainer>
  );
};

export default DeviceModelFilter;
