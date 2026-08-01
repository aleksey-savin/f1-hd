import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Combobox from "@/components/app/Combobox";

import useUserFilterStore from "../../store/lists/users";
import useInitialPrefs from "../../store/prefs";

// Sheet-фильтр адресной книги. Набор (Все/Сотрудники/Клиенты) — сегментом над
// списком; здесь — компания (ключевой фасет), присутствие, активность и
// параметры аккаунта.
const ACTIVITY_OPTIONS = [
  { value: "any", label: "Любая" },
  { value: "currentMonth", label: "В этом месяце" },
  { value: "currentYear", label: "В этом году" },
  { value: "inactive6m", label: "Не обращались больше 6 месяцев" },
];

const UserFilter = () => {
  const s = useUserFilterStore();
  // Фасет PRO32 показываем только при включённой глобальной интеграции
  const pro32Relevant = !!useInitialPrefs().getScreen?.isActive;
  // присутствие есть только у сотрудников — в наборе «Клиенты» фасет прячем
  const presenceRelevant = s.audience !== "clients";
  const companyOption =
    s.companyOptions.find((option) => option.value === s.company) ?? null;

  return (
    <FilterContainer resetFilterHandler={s.resetFilter}>
      <Field label="Компания" htmlFor="filter-company">
        <Combobox
          id="filter-company"
          placeholder="Все компании"
          clearable
          clearLabel="Все компании"
          value={companyOption?.value ?? null}
          options={s.companyOptions}
          onChange={(value) => s.setCompany(value)}
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
        className="mt-2"
      >
        <Combobox
          id="filter-activity"
          placeholder="Любая"
          value={s.activity || "any"}
          options={ACTIVITY_OPTIONS}
          onChange={(value) => s.updateFilter({ activity: value ?? "any" })}
        />
      </Field>

      {pro32Relevant && (
        <SwitchField
          id="filter-pro32"
          checked={!!s.pro32}
          onCheckedChange={(value) => s.updateFilter({ pro32: value })}
          label="Подключён PRO32 Connect"
          hint="Задан персональный API-ключ удалённого подключения."
          divider
        />
      )}

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
