import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";

import Combobox, { MultiCombobox } from "@/components/app/Combobox";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

export const STATUS_OPTIONS = [
  { value: "online", label: "В сети" },
  { value: "offline", label: "Не в сети" },
  { value: "disabled", label: "Мониторинг выключен" },
];

export const FIRMWARE_OPTIONS = [
  { value: "vulnerable", label: "С уязвимостями" },
  { value: "outdated", label: "Есть обновление" },
  { value: "current", label: "Актуальная" },
];

// Sheet-фильтр списка мониторинга: статус · компании · тип устройства ·
// прошивка. Опции компаний и типов собираются из загруженного списка — фильтр
// сужает то, что реально есть. Применённое видно снимаемыми бейджами страницы.
const DeviceFilter = ({ companyOptions, typeOptions }) => {
  const facets = useMikrotikDeviceFilterStore((state) => state.facets);
  const setFacet = useMikrotikDeviceFilterStore((state) => state.setFacet);
  const resetFilter = useMikrotikDeviceFilterStore(
    (state) => state.resetFilter,
  );

  return (
    <FilterContainer resetFilterHandler={resetFilter}>
      <div className="space-y-4 pt-4">
        <Field label="Статус" htmlFor="mikrotik-filter-status">
          <Combobox
            id="mikrotik-filter-status"
            options={STATUS_OPTIONS}
            value={facets.status ?? null}
            onChange={(value) => setFacet("status", value)}
            placeholder="Любой"
            clearable
            clearLabel="Любой"
          />
        </Field>
        <Field label="Компании" htmlFor="mikrotik-filter-companies">
          <MultiCombobox
            id="mikrotik-filter-companies"
            options={companyOptions}
            value={facets.companies}
            onChange={(values) => setFacet("companies", values)}
            placeholder="Все компании"
          />
        </Field>
        <Field label="Тип устройства" htmlFor="mikrotik-filter-type">
          <Combobox
            id="mikrotik-filter-type"
            options={typeOptions}
            value={facets.type ?? null}
            onChange={(value) => setFacet("type", value)}
            placeholder="Любой"
            clearable
            clearLabel="Любой"
          />
        </Field>
        <Field label="Прошивка" htmlFor="mikrotik-filter-firmware">
          <Combobox
            id="mikrotik-filter-firmware"
            options={FIRMWARE_OPTIONS}
            value={facets.firmware ?? null}
            onChange={(value) => setFacet("firmware", value)}
            placeholder="Любая"
            clearable
            clearLabel="Любая"
          />
        </Field>
      </div>
    </FilterContainer>
  );
};

export default DeviceFilter;
