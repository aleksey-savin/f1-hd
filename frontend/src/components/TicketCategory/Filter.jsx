import { useContext, useMemo } from "react";

import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import Select from "../../UI/Select";
import useTicketCategoryFilterStore from "../../store/lists/ticket-categories";
import { AuthedUserContext } from "../../store/authed-user-context";

// Sheet-фильтр справочника. Применённое видно в липкой плашке бейджей
// ListWrapper. Фасеты «Пользователи»/«Услуги» храним объектами {_id, name} —
// опции собираем из загруженных категорий (originalList). Блок услуг и «в
// рамках тарифа» — только при доступе к модулю финансов.
const TicketCategoryFilter = () => {
  const { permissions } = useContext(AuthedUserContext);
  const filterStore = useTicketCategoryFilterStore();
  const items = filterStore.originalList || [];
  const showFinances = permissions.canUseFinancesModule;

  const userOptions = useMemo(() => {
    const map = new Map();
    items.forEach((category) => {
      (category.users || []).forEach((user) => {
        const id = String(user._id);
        if (!map.has(id)) {
          map.set(id, { _id: id, name: `${user.lastName} ${user.firstName}` });
        }
      });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const planOptions = useMemo(() => {
    const map = new Map();
    items.forEach((category) => {
      (category.servicePlans || []).forEach((plan) => {
        const id = String(plan._id);
        if (!map.has(id)) {
          map.set(id, { _id: id, title: plan.title });
        }
      });
    });
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [items]);

  const isActiveToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      isActive: !filterStore.isActive,
    });
    filterStore.applyFilter();
  };

  const alwaysWithinPlanToggleHandler = () => {
    filterStore.updateFilter({
      ...filterStore,
      alwaysWithinPlan: !filterStore.alwaysWithinPlan,
    });
    filterStore.applyFilter();
  };

  const usersChangeHandler = (selected) => {
    filterStore.updateFilter({ ...filterStore, users: selected || [] });
    filterStore.applyFilter();
  };

  const plansChangeHandler = (selected) => {
    filterStore.updateFilter({ ...filterStore, servicePlans: selected || [] });
    filterStore.applyFilter();
  };

  return (
    <FilterContainer resetFilterHandler={filterStore.resetFilter}>
      <SwitchField
        id="filter-is-active"
        checked={!!filterStore.isActive}
        onCheckedChange={isActiveToggleHandler}
        label="Только активные"
      />
      {showFinances && (
        <SwitchField
          id="filter-always-within-plan"
          checked={!!filterStore.alwaysWithinPlan}
          onCheckedChange={alwaysWithinPlanToggleHandler}
          label="Всегда в рамках тарифа"
          divider
        />
      )}
      <Field
        label="Пользователи"
        htmlFor="filter-users"
        hint="Категории, доступные выбранным пользователям"
        className="tw:mt-2"
      >
        <Select
          id="filter-users"
          placeholder="Выберите пользователей..."
          value={filterStore.users || []}
          options={userOptions}
          isMulti
          isClearable
          isSearchable
          closeMenuOnSelect={false}
          getOptionLabel={(option) => option.name}
          getOptionValue={(option) => option._id}
          onChange={usersChangeHandler}
        />
      </Field>
      {showFinances && (
        <Field
          label="Услуги"
          htmlFor="filter-plans"
          hint="Категории, привязанные к выбранным услугам"
          className="tw:mt-2"
        >
          <Select
            id="filter-plans"
            placeholder="Выберите услуги..."
            value={filterStore.servicePlans || []}
            options={planOptions}
            isMulti
            isClearable
            isSearchable
            closeMenuOnSelect={false}
            getOptionLabel={(option) => option.title}
            getOptionValue={(option) => option._id}
            onChange={plansChangeHandler}
          />
        </Field>
      )}
    </FilterContainer>
  );
};

export default TicketCategoryFilter;
