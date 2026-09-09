import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";
import SwitchField from "@/components/app/SwitchField";

import Combobox, { MultiCombobox } from "@/components/app/Combobox";

import useUserFilterStore from "../../store/lists/users";
import useInitialPrefs from "../../store/prefs";

// Sheet-фильтр адресной книги. Набор (Все/Сотрудники/Клиенты) — сегментом над
// списком; здесь — компания (ключевой фасет), присутствие, активность и
// параметры аккаунта.
// Активность и служебные аккаунты — сегменты, а не выпадающие списки: у обоих
// по три-четыре взаимоисключающих значения, и выбор виден без раскрытия. Полные
// формулировки «в этом месяце»/«больше полугода» в сегмент не влезают (шторка
// max-w-sm) — их держит подсказка поля.
const ACTIVITY_OPTIONS = [
  { value: "any", label: "Любая" },
  { value: "currentMonth", label: "Месяц" },
  { value: "currentYear", label: "Год" },
  { value: "inactive6m", label: "Давно" },
];

// Служебные — три состояния, а не тумблер «показывать»: «только служебные» это
// самостоятельный срез (проверить телефонию и интеграционные учётки), и через
// тумблер он не набирался.
const SERVICE_OPTIONS = [
  { value: "any", label: "Все" },
  { value: "only", label: "Только" },
  { value: "hide", label: "Скрыть" },
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

      {/* Справочник пуст у того, кому не видны роли, — тогда и фасета нет */}
      {s.roleOptions.length > 0 && (
        <Field
          label="Роль"
          htmlFor="filter-roles"
          hint="Несколько ролей — покажем всех, у кого есть хотя бы одна."
        >
          <MultiCombobox
            id="filter-roles"
            placeholder="Любая роль"
            value={s.roles}
            options={s.roleOptions}
            onChange={(keys) => s.updateFilter({ roles: keys })}
          />
        </Field>
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
        hint="«Месяц» и «Год» — с начала текущего, «Давно» — больше полугода назад или никогда."
        className="mt-2"
      >
        <Segmented
          ariaLabel="Последняя активность"
          options={ACTIVITY_OPTIONS}
          value={s.activity || "any"}
          onChange={(value) => s.updateFilter({ activity: value })}
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
      <Field
        label="Служебные аккаунты"
        hint="Сервисные учётки и телефония."
        className="mt-3"
      >
        <Segmented
          ariaLabel="Служебные аккаунты"
          options={SERVICE_OPTIONS}
          value={s.service || "hide"}
          onChange={(value) => s.updateFilter({ service: value })}
        />
      </Field>
    </FilterContainer>
  );
};

export default UserFilter;
