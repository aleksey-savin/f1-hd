import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import { Input } from "@/components/ui/input";

import Select from "../../UI/Select";
import useWorksStore from "../../store/lists/works";

// Sheet-фильтр сегмента «Работы» архива. Все условия опциональны (обязательных
// «компания + период» легаси-отчёта больше нет): период по дате завершения —
// два нативных поля даты, остальное — мультиселекты по полному каталогу
// form-data. Категории — свойство связанных заявок; исполнители — активные
// пользователи с правом выполнения заявок.
const byIds = (options, ids) =>
  options.filter((option) => ids.includes(option.value));

const toIds = (selected) => (selected || []).map((option) => option.value);

const WorkArchiveFilter = () => {
  const s = useWorksStore();

  return (
    <FilterContainer resetFilterHandler={s.resetFilter}>
      <Field label="Завершена в период" htmlFor="work-filter-period-from">
        <div className="tw:grid tw:grid-cols-2 tw:gap-2">
          <Input
            id="work-filter-period-from"
            type="date"
            aria-label="Начало периода"
            value={s.from}
            max={s.to || undefined}
            onChange={(event) => s.updateFilter({ from: event.target.value })}
          />
          <Input
            id="work-filter-period-to"
            type="date"
            aria-label="Конец периода"
            value={s.to}
            min={s.from || undefined}
            onChange={(event) => s.updateFilter({ to: event.target.value })}
          />
        </div>
      </Field>

      <Field label="Компании" htmlFor="work-filter-companies">
        <Select
          id="work-filter-companies"
          placeholder="Все компании"
          isMulti
          isClearable
          isSearchable
          value={byIds(s.options.companies, s.companies)}
          options={s.options.companies}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={(selected) => s.updateFilter({ companies: toIds(selected) })}
        />
      </Field>

      <Field label="Категории" htmlFor="work-filter-categories">
        <Select
          id="work-filter-categories"
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

      <Field label="Исполнители" htmlFor="work-filter-executors">
        <Select
          id="work-filter-executors"
          placeholder="Все исполнители"
          isMulti
          isClearable
          isSearchable
          value={byIds(s.options.executors, s.executors)}
          options={s.options.executors}
          getOptionLabel={(option) => option.label}
          getOptionValue={(option) => option.value}
          onChange={(selected) => s.updateFilter({ executors: toIds(selected) })}
        />
      </Field>
    </FilterContainer>
  );
};

export default WorkArchiveFilter;
