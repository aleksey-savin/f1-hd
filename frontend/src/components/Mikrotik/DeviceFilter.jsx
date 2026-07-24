import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";

import Select from "../../UI/Select";
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

const withAny = (label, options) => [{ value: null, label }, ...options];

const findOption = (options, value) =>
  options.find((option) => option.value === value) || options[0];

// Sheet-фильтр списка мониторинга: статус · компании · тип устройства ·
// прошивка. Опции компаний и типов собираются из загруженного списка — фильтр
// сужает то, что реально есть. Применённое видно снимаемыми бейджами страницы.
const DeviceFilter = ({ companyOptions, typeOptions }) => {
  const facets = useMikrotikDeviceFilterStore((state) => state.facets);
  const setFacet = useMikrotikDeviceFilterStore((state) => state.setFacet);
  const resetFilter = useMikrotikDeviceFilterStore(
    (state) => state.resetFilter,
  );

  const statusOptions = withAny("Любой", STATUS_OPTIONS);
  const firmwareOptions = withAny("Любая", FIRMWARE_OPTIONS);
  const kindOptions = withAny("Любой", typeOptions);

  return (
    <FilterContainer resetFilterHandler={resetFilter}>
      <div className="tw:space-y-4 tw:pt-4">
        <Field label="Статус" htmlFor="mikrotik-filter-status">
          <Select
            id="mikrotik-filter-status"
            options={statusOptions}
            value={findOption(statusOptions, facets.status)}
            onChange={(option) => setFacet("status", option?.value ?? null)}
          />
        </Field>
        <Field label="Компании" htmlFor="mikrotik-filter-companies">
          <Select
            id="mikrotik-filter-companies"
            isMulti
            options={companyOptions}
            value={companyOptions.filter((option) =>
              facets.companies.includes(option.value),
            )}
            onChange={(selected) =>
              setFacet(
                "companies",
                (selected || []).map((option) => option.value),
              )
            }
            placeholder="Все компании"
          />
        </Field>
        <Field label="Тип устройства" htmlFor="mikrotik-filter-type">
          <Select
            id="mikrotik-filter-type"
            options={kindOptions}
            value={findOption(kindOptions, facets.type)}
            onChange={(option) => setFacet("type", option?.value ?? null)}
          />
        </Field>
        <Field label="Прошивка" htmlFor="mikrotik-filter-firmware">
          <Select
            id="mikrotik-filter-firmware"
            options={firmwareOptions}
            value={findOption(firmwareOptions, facets.firmware)}
            onChange={(option) => setFacet("firmware", option?.value ?? null)}
          />
        </Field>
      </div>
    </FilterContainer>
  );
};

export default DeviceFilter;
