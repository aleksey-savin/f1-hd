import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";
import { Input } from "@/components/ui/input";

import useCompaniesTrendsStore from "../../store/reports/companies-trends";

// Sheet-фильтр «Динамики» — даты произвольного диапазона (пресет
// «Произвольный»). Запрос уходит, когда заданы обе (гард в сторе);
// «Сбросить» возвращает пресет «12 месяцев».
const TrendsFilter = () => {
  const s = useCompaniesTrendsStore();

  return (
    <FilterContainer
      resetFilterHandler={() =>
        s.setParams({ preset: "12months", startDate: "", endDate: "" })
      }
    >
      <Field label="Произвольный диапазон" htmlFor="trends-period-from">
        <div className="tw:grid tw:grid-cols-2 tw:gap-2">
          <Input
            id="trends-period-from"
            type="date"
            aria-label="Начало диапазона"
            value={s.startDate}
            max={s.endDate || undefined}
            onChange={(event) => s.setParams({ startDate: event.target.value })}
          />
          <Input
            id="trends-period-to"
            type="date"
            aria-label="Конец диапазона"
            value={s.endDate}
            min={s.startDate || undefined}
            onChange={(event) => s.setParams({ endDate: event.target.value })}
          />
        </div>
      </Field>
    </FilterContainer>
  );
};

export default TrendsFilter;
