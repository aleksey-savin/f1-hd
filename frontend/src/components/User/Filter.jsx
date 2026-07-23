import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Select from "../../UI/Select";
import useUserFilterStore from "../../store/lists/users";

// Sheet-фильтр адресной книги. Набор (Все/Сотрудники/Клиенты) — сегментом над
// списком; здесь — компания (ключевой фасет), присутствие, активность и
// параметры аккаунта. UI/Select внутри шторки работает через InsideOverlayContext.
const ACTIVITY_OPTIONS = [
  { value: "any", label: "Любая" },
  { value: "currentMonth", label: "В этом месяце" },
  { value: "currentYear", label: "В этом году" },
  { value: "inactive6m", label: "Не обращались больше 6 месяцев" },
];

const UserFilter = () => {
  const s = useUserFilterStore();
  // присутствие есть только у сотрудников — в наборе «Клиенты» фасет прячем
  const presenceRelevant = s.audience !== "clients";
  const companyOption =
    s.companyOptions.find((option) => option.value === s.company) ?? null;

  return (
    <FilterContainer resetFilterHandler={s.resetFilter}>
      <Field label="Компания" htmlFor="filter-company">
        <Select
          id="filter-company"
          placeholder="Все компании"
          isClearable
          closeMenuOnSelect
          value={companyOption}
          options={s.companyOptions}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={(option) => s.setCompany(option?.value ?? null)}
        />
      </Field>

      {s.company && (
        <SwitchField
          id="filter-group-subdivision"
          checked={!!s.groupBySubdivision}
          onCheckedChange={() => s.toggleGroupBySubdivision()}
          label="Группировать по подразделению"
          hint="Разбить людей выбранной компании на подразделения."
        />
      )}

      {presenceRelevant && (
        <SwitchField
          id="filter-online"
          checked={!!s.online}
          onCheckedChange={(value) => s.updateFilter({ online: value })}
          label="Только на связи"
          hint="В офисе, на удалёнке или на выезде. Только сотрудники."
          divider
        />
      )}

      <Field
        label="Последняя активность"
        htmlFor="filter-activity"
        className="tw:mt-2"
      >
        <Select
          id="filter-activity"
          placeholder="Любая"
          closeMenuOnSelect
          value={ACTIVITY_OPTIONS.filter(
            (option) => option.value === (s.activity || "any"),
          )}
          options={ACTIVITY_OPTIONS}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={(option) =>
            s.updateFilter({ activity: option?.value ?? "any" })
          }
        />
      </Field>

      <SwitchField
        id="filter-active"
        checked={!!s.activeOnly}
        onCheckedChange={(value) => s.updateFilter({ activeOnly: value })}
        label="Только активные"
        divider
      />
      <SwitchField
        id="filter-service"
        checked={!!s.includeService}
        onCheckedChange={(value) => s.updateFilter({ includeService: value })}
        label="Показывать служебные"
        hint="Сервисные аккаунты и телефония."
      />
    </FilterContainer>
  );
};

export default UserFilter;
