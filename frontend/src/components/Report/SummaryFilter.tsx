import DateRangeField from "@/components/app/DateRangeField";
import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";

import useCompaniesSummaryStore from "../../store/reports/companies-summary";

// Sheet-фильтр «Сводки»: произвольный период одним полем-календарём (паттерн
// архива работ). «Сбросить» возвращает текущий месяц (дефолт отчёта).
// Запрос уходит, когда заданы обе границы (гард в сторе).
const SummaryFilter = () => {
  const s = useCompaniesSummaryStore();

  return (
    <FilterContainer resetFilterHandler={s.resetPeriod}>
      <Field label="Период" htmlFor="analytics-period">
        <DateRangeField
          id="analytics-period"
          value={{ from: s.from, to: s.to }}
          onChange={(range) => s.setPeriod(range)}
        />
      </Field>
    </FilterContainer>
  );
};

export default SummaryFilter;
