import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";
import { Input } from "@/components/ui/input";

import useAnalyticsSummaryStore from "../../store/reports/analytics-summary";

// Sheet-фильтр «Сводки»: произвольный период двумя нативными датами (паттерн
// архива работ). «Сбросить» возвращает текущий месяц (дефолт аналитики).
// Запрос уходит, когда заданы обе границы (гард в сторе).
const SummaryFilter = () => {
  const s = useAnalyticsSummaryStore();

  return (
    <FilterContainer resetFilterHandler={s.resetPeriod}>
      <Field label="Период" htmlFor="analytics-period-from">
        <div className="tw:grid tw:grid-cols-2 tw:gap-2">
          <Input
            id="analytics-period-from"
            type="date"
            aria-label="Начало периода"
            value={s.from}
            max={s.to || undefined}
            onChange={(event) => s.setPeriod({ from: event.target.value })}
          />
          <Input
            id="analytics-period-to"
            type="date"
            aria-label="Конец периода"
            value={s.to}
            min={s.from || undefined}
            onChange={(event) => s.setPeriod({ to: event.target.value })}
          />
        </div>
      </Field>
    </FilterContainer>
  );
};

export default SummaryFilter;
