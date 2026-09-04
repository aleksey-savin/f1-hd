import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import DateRangeField from "@/components/app/DateRangeField";

import { MultiCombobox } from "@/components/app/Combobox";

import useClosedTicketsStore from "../../store/lists/closed-tickets";

// Sheet-фильтр архива заявок. Все условия опциональны: период по дате закрытия
// — одно поле-календарь, остальное — мультиселекты по полному каталогу
// form-data (включая отключённые компании: архив ищет по истории). Выбранное
// хранится в сторе массивами id — ими же говорит MultiCombobox.
const ArchiveFilter = () => {
  const s = useClosedTicketsStore();

  return (
    <FilterContainer resetFilterHandler={s.resetFilter}>
      <Field label="Закрыта в период" htmlFor="filter-period">
        <DateRangeField
          id="filter-period"
          value={{ from: s.from, to: s.to }}
          onChange={(range) => s.updateFilter(range)}
        />
      </Field>

      <Field label="Компании" htmlFor="filter-companies">
        <MultiCombobox
          id="filter-companies"
          placeholder="Все компании"
          value={s.companies}
          options={s.options.companies}
          onChange={(values) => s.updateFilter({ companies: values })}
        />
      </Field>

      <Field label="Инициаторы" htmlFor="filter-applicants">
        <MultiCombobox
          id="filter-applicants"
          placeholder="Все инициаторы"
          value={s.applicants}
          options={s.options.applicants}
          onChange={(values) => s.updateFilter({ applicants: values })}
        />
      </Field>

      <Field label="Ответственные" htmlFor="filter-responsibles">
        <MultiCombobox
          id="filter-responsibles"
          placeholder="Все ответственные"
          value={s.responsibles}
          options={s.options.responsibles}
          onChange={(values) => s.updateFilter({ responsibles: values })}
        />
      </Field>

      <Field label="Категории" htmlFor="filter-categories">
        <MultiCombobox
          id="filter-categories"
          placeholder="Все категории"
          value={s.categories}
          options={s.options.categories}
          onChange={(values) => s.updateFilter({ categories: values })}
        />
      </Field>
    </FilterContainer>
  );
};

export default ArchiveFilter;
