import FilterContainer from "@/components/app/FilterContainer";
import Field from "@/components/app/Field";
import { Input } from "@/components/ui/input";

import { MultiCombobox } from "@/components/app/Combobox";

import useWorksStore from "../../store/lists/works";

// Sheet-фильтр сегмента «Работы» архива. Все условия опциональны (обязательных
// «компания + период» легаси-отчёта больше нет): период по дате завершения —
// два нативных поля даты, остальное — мультиселекты по полному каталогу
// form-data. Категории — свойство связанных заявок; исполнители — активные
// пользователи с правом выполнения заявок.
const WorkArchiveFilter = () => {
  const s = useWorksStore();

  return (
    <FilterContainer resetFilterHandler={s.resetFilter}>
      <Field label="Завершена в период" htmlFor="work-filter-period-from">
        <div className="grid grid-cols-2 gap-2">
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
        <MultiCombobox
          id="work-filter-companies"
          placeholder="Все компании"
          value={s.companies}
          options={s.options.companies}
          onChange={(values) => s.updateFilter({ companies: values })}
        />
      </Field>

      <Field label="Категории" htmlFor="work-filter-categories">
        <MultiCombobox
          id="work-filter-categories"
          placeholder="Все категории"
          value={s.categories}
          options={s.options.categories}
          onChange={(values) => s.updateFilter({ categories: values })}
        />
      </Field>

      <Field label="Исполнители" htmlFor="work-filter-executors">
        <MultiCombobox
          id="work-filter-executors"
          placeholder="Все исполнители"
          value={s.executors}
          options={s.options.executors}
          onChange={(values) => s.updateFilter({ executors: values })}
        />
      </Field>
    </FilterContainer>
  );
};

export default WorkArchiveFilter;
