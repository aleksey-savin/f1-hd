import { useMemo } from "react";

import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";

import { MultiCombobox } from "@/components/app/Combobox";

import { COMPONENTS_OPTIONS } from "./components-facet";
import useClientDeviceFilterStore from "../../store/lists/client-devices";

/**
 * Sheet-фильтр реестра устройств: компании · расположения · закреплено за ·
 * тип · производитель. Статуса здесь нет — он живёт лентой парка над списком,
 * а дублировать применённое незачем.
 *
 * Опции приходят отдельной ручкой (`/client-devices/facets`) и содержат только
 * то, что реально есть в видимом парке: фильтр сужает существующее, а не
 * предлагает пустые значения. Расположения — фасет ВТОРОГО шага: до выбора
 * компании поля нет вовсе (список расползался бы на все объекты всех клиентов,
 * а подсказка «сначала выберите компанию» занимала место поля, которым нельзя
 * пользоваться).
 */
const ClientDeviceFilter = () => {
  const facets = useClientDeviceFilterStore((state) => state.facets);
  const options = useClientDeviceFilterStore((state) => state.options);
  const setFacet = useClientDeviceFilterStore((state) => state.setFacet);
  const resetFilter = useClientDeviceFilterStore((state) => state.resetFilter);

  // Поле показывается только с выбранными компаниями, поэтому и список
  // расположений здесь всегда «под компании»
  const locationOptions = useMemo(
    () =>
      options.locations.filter((option) =>
        facets.companies.includes(option.company),
      ),
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
        {facets.companies.length > 0 && (
          <Field label="Расположения" htmlFor="device-filter-locations">
            <MultiCombobox
              id="device-filter-locations"
              placeholder="Любое"
              {...multi("locations", locationOptions)}
            />
          </Field>
        )}
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

        {/* Тот же фасет стоит сегментом в строке инструментов — это одно
            значение стора, а не две настройки: здесь он повторён, чтобы полный
            набор условий читался в одном месте. */}
        <div className="border-t border-border-soft pt-4">
          <Field
            label="Что показывать"
            hint="Комплектующие — детали внутри сборок: память, диски, платы. Поиск находит их в любом режиме."
            className="mb-0"
          >
            <Segmented
              ariaLabel="Что показывать"
              options={COMPONENTS_OPTIONS}
              value={facets.components}
              onChange={(value) => setFacet("components", value)}
            />
          </Field>
        </div>
      </div>
    </FilterContainer>
  );
};

export default ClientDeviceFilter;
