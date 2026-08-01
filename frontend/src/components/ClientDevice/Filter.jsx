import { useMemo } from "react";

import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import { MultiCombobox } from "@/components/app/Combobox";

import useClientDeviceFilterStore from "../../store/lists/client-devices";

/**
 * Sheet-фильтр реестра устройств: компании · расположения · закреплено за ·
 * тип · производитель. Статуса здесь нет — он живёт лентой парка над списком,
 * а дублировать применённое незачем.
 *
 * Опции приходят отдельной ручкой (`/client-devices/facets`) и содержат только
 * то, что реально есть в видимом парке: фильтр сужает существующее, а не
 * предлагает пустые значения. Расположения показываются под выбранные
 * компании — иначе список расползается на все объекты всех клиентов.
 */
const ClientDeviceFilter = () => {
  const facets = useClientDeviceFilterStore((state) => state.facets);
  const options = useClientDeviceFilterStore((state) => state.options);
  const setFacet = useClientDeviceFilterStore((state) => state.setFacet);
  const resetFilter = useClientDeviceFilterStore((state) => state.resetFilter);

  const locationOptions = useMemo(
    () =>
      facets.companies.length
        ? options.locations.filter((option) =>
            facets.companies.includes(option.company),
          )
        : options.locations,
    [options.locations, facets.companies],
  );

  // Фасеты хранятся массивами id — MultiCombobox говорит ими же
  const multi = (key, optionList) => ({
    options: optionList,
    value: facets[key],
    onChange: (values) => setFacet(key, values),
  });

  return (
    <FilterContainer resetFilterHandler={resetFilter}>
      <div className="space-y-4 pt-4">
        <Field label="Компании" htmlFor="device-filter-companies">
          <MultiCombobox
            id="device-filter-companies"
            placeholder="Все компании"
            {...multi("companies", options.companies)}
          />
        </Field>
        <Field
          label="Расположения"
          htmlFor="device-filter-locations"
          hint={
            facets.companies.length
              ? undefined
              : "Выберите компанию, чтобы сузить список расположений"
          }
        >
          <MultiCombobox
            id="device-filter-locations"
            placeholder="Любое"
            {...multi("locations", locationOptions)}
          />
        </Field>
        <Field label="Закреплено за" htmlFor="device-filter-users">
          <MultiCombobox
            id="device-filter-users"
            placeholder="Любой сотрудник"
            {...multi("users", options.users)}
          />
        </Field>
        <Field label="Тип устройства" htmlFor="device-filter-types">
          <MultiCombobox
            id="device-filter-types"
            placeholder="Любой"
            {...multi("types", options.types)}
          />
        </Field>
        <Field
          label="Производитель"
          htmlFor="device-filter-vendors"
          hint="Самосборные устройства — «Кастомная сборка»"
        >
          <MultiCombobox
            id="device-filter-vendors"
            placeholder="Любой"
            {...multi("vendors", options.vendors)}
          />
        </Field>

        {/* Детали сборок в реестре не показываются: они не выдаются и не
            перемещаются сами по себе. Свитч — для просмотра («все модули
            памяти»); поиск находит их и без него. */}
        <div className="border-t border-border-soft pt-4">
          <SwitchField
            id="device-filter-components"
            label="Показывать комплектующие"
            hint="Детали сборок обычно не в списке — поиск находит их и так."
            checked={facets.withComponents}
            onCheckedChange={() =>
              setFacet("withComponents", !facets.withComponents)
            }
          />
        </div>
      </div>
    </FilterContainer>
  );
};

export default ClientDeviceFilter;
