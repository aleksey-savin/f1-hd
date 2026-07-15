import { useMemo } from "react";

import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";

import Select from "../../UI/Select";
import useServicePlanFilterStore from "../../store/lists/service-plans";
import { TARIFF_TYPES } from "./tariff-types";

// «Любой» сбрасывает фасет типа
const TYPE_SELECT_OPTIONS = [{ value: "any", label: "Любой" }, ...TARIFF_TYPES];

// Sheet-фильтр справочника. Применённое видно в липкой плашке бейджей.
// Фасеты «Компании»/«Категории» — объектами; опции собираем из загруженных
// услуг (originalList).
const ServicePlanFilter = () => {
  const filterStore = useServicePlanFilterStore();
  const items = filterStore.originalList || [];

  const companyOptions = useMemo(() => {
    const map = new Map();
    items.forEach((plan) => {
      (plan.companies || []).forEach((company) => {
        const id = String(company._id);
        if (!map.has(id)) map.set(id, { _id: id, alias: company.alias });
      });
    });
    return [...map.values()].sort((a, b) =>
      (a.alias || "").localeCompare(b.alias || ""),
    );
  }, [items]);

  const categoryOptions = useMemo(() => {
    const map = new Map();
    items.forEach((plan) => {
      (plan.ticketCategories || []).forEach((category) => {
        const id = String(category._id);
        if (!map.has(id)) map.set(id, { _id: id, title: category.title });
      });
    });
    return [...map.values()].sort((a, b) =>
      (a.title || "").localeCompare(b.title || ""),
    );
  }, [items]);

  const typeChangeHandler = (option) => {
    filterStore.updateFilter({ ...filterStore, type: option?.value ?? "any" });
    filterStore.applyFilter();
  };

  const companiesChangeHandler = (selected) => {
    filterStore.updateFilter({ ...filterStore, companies: selected || [] });
    filterStore.applyFilter();
  };

  const categoriesChangeHandler = (selected) => {
    filterStore.updateFilter({
      ...filterStore,
      ticketCategories: selected || [],
    });
    filterStore.applyFilter();
  };

  return (
    <FilterContainer resetFilterHandler={filterStore.resetFilter}>
      <Field label="Тип тарификации" htmlFor="filter-type">
        <Select
          id="filter-type"
          placeholder="Любой"
          closeMenuOnSelect
          value={TYPE_SELECT_OPTIONS.filter(
            (option) => option.value === (filterStore.type || "any"),
          )}
          options={TYPE_SELECT_OPTIONS}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={typeChangeHandler}
        />
      </Field>
      <Field label="Компании" htmlFor="filter-companies" className="tw:mt-2">
        <Select
          id="filter-companies"
          placeholder="Выберите компании..."
          value={filterStore.companies || []}
          options={companyOptions}
          isMulti
          isClearable
          isSearchable
          closeMenuOnSelect={false}
          getOptionLabel={(option) => option.alias}
          getOptionValue={(option) => option._id}
          onChange={companiesChangeHandler}
        />
      </Field>
      <Field
        label="Категории заявок"
        htmlFor="filter-categories"
        className="tw:mt-2"
      >
        <Select
          id="filter-categories"
          placeholder="Выберите категории..."
          value={filterStore.ticketCategories || []}
          options={categoryOptions}
          isMulti
          isClearable
          isSearchable
          closeMenuOnSelect={false}
          getOptionLabel={(option) => option.title}
          getOptionValue={(option) => option._id}
          onChange={categoriesChangeHandler}
        />
      </Field>
    </FilterContainer>
  );
};

export default ServicePlanFilter;
