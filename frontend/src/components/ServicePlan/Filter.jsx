import { useMemo } from "react";

import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";

import Combobox, { MultiCombobox, toOptions } from "@/components/app/Combobox";

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

  const typeChangeHandler = (value) => {
    filterStore.updateFilter({ ...filterStore, type: value ?? "any" });
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
        <Combobox
          id="filter-type"
          placeholder="Любой"
          value={filterStore.type || "any"}
          options={TYPE_SELECT_OPTIONS}
          onChange={typeChangeHandler}
        />
      </Field>
      <Field label="Компании" htmlFor="filter-companies" className="mt-2">
        <MultiCombobox
          id="filter-companies"
          placeholder="Выберите компании..."
          value={(filterStore.companies || []).map((item) => String(item._id))}
          options={toOptions(companyOptions, {
            value: (option) => String(option._id),
            label: (option) => option.alias,
          })}
          onChange={(ids) =>
            companiesChangeHandler(
              companyOptions.filter((option) =>
                ids.includes(String(option._id)),
              ),
            )
          }
        />
      </Field>
      <Field
        label="Категории заявок"
        htmlFor="filter-categories"
        className="mt-2"
      >
        <MultiCombobox
          id="filter-categories"
          placeholder="Выберите категории..."
          value={(filterStore.ticketCategories || []).map((item) =>
            String(item._id),
          )}
          options={toOptions(categoryOptions, {
            value: (option) => String(option._id),
            label: (option) => option.title,
          })}
          onChange={(ids) =>
            categoriesChangeHandler(
              categoryOptions.filter((option) =>
                ids.includes(String(option._id)),
              ),
            )
          }
        />
      </Field>
    </FilterContainer>
  );
};

export default ServicePlanFilter;
