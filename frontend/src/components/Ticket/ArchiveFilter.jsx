import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import { Input } from "@/components/ui/input";

import Select from "../../UI/Select";
import useClosedTicketsStore from "../../store/lists/closed-tickets";

// Sheet-фильтр архива заявок. Все условия опциональны: период по дате закрытия
// — два нативных поля даты, остальное — мультиселекты по полному каталогу
// form-data (включая отключённые компании: архив ищет по истории). Выбранное
// хранится в сторе массивами id; UI/Select внутри шторки работает через
// InsideOverlayContext.
const byIds = (options, ids) =>
  options.filter((option) => ids.includes(option.value));

const toIds = (selected) => (selected || []).map((option) => option.value);

const ArchiveFilter = () => {
  const s = useClosedTicketsStore();

  return (
    <FilterContainer resetFilterHandler={s.resetFilter}>
      <Field label="Закрыта в период" htmlFor="filter-period-from">
        <div className="tw:grid tw:grid-cols-2 tw:gap-2">
          <Input
            id="filter-period-from"
            type="date"
            aria-label="Начало периода"
            value={s.from}
            max={s.to || undefined}
            onChange={(event) => s.updateFilter({ from: event.target.value })}
          />
          <Input
            id="filter-period-to"
            type="date"
            aria-label="Конец периода"
            value={s.to}
            min={s.from || undefined}
            onChange={(event) => s.updateFilter({ to: event.target.value })}
          />
        </div>
      </Field>

      <Field label="Компании" htmlFor="filter-companies">
        <Select
          id="filter-companies"
          placeholder="Все компании"
          isMulti
          isClearable
          isSearchable
          value={byIds(s.options.companies, s.companies)}
          options={s.options.companies}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={(selected) =>
            s.updateFilter({ companies: toIds(selected) })
          }
        />
      </Field>

      <Field label="Инициаторы" htmlFor="filter-applicants">
        <Select
          id="filter-applicants"
          placeholder="Все инициаторы"
          isMulti
          isClearable
          isSearchable
          value={byIds(s.options.applicants, s.applicants)}
          options={s.options.applicants}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={(selected) =>
            s.updateFilter({ applicants: toIds(selected) })
          }
        />
      </Field>

      <Field label="Ответственные" htmlFor="filter-responsibles">
        <Select
          id="filter-responsibles"
          placeholder="Все ответственные"
          isMulti
          isClearable
          isSearchable
          value={byIds(s.options.responsibles, s.responsibles)}
          options={s.options.responsibles}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={(selected) =>
            s.updateFilter({ responsibles: toIds(selected) })
          }
        />
      </Field>

      <Field label="Категории" htmlFor="filter-categories">
        <Select
          id="filter-categories"
          placeholder="Все категории"
          isMulti
          isClearable
          isSearchable
          value={byIds(s.options.categories, s.categories)}
          options={s.options.categories}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={(selected) =>
            s.updateFilter({ categories: toIds(selected) })
          }
        />
      </Field>
    </FilterContainer>
  );
};

export default ArchiveFilter;
