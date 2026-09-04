import DateRangeField from "@/components/app/DateRangeField";
import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";

import useCompaniesTrendsStore from "../../store/reports/companies-trends";

// Sheet-фильтр «Динамики» — произвольный диапазон одним полем-календарём
// (пресет «Произвольный»); крестика очистки нет: пустой диапазон оставил бы
// пресет без данных. Запрос уходит, когда заданы обе (гард в сторе);
// «Сбросить» возвращает пресет «12 месяцев».
const TrendsFilter = () => {
  const s = useCompaniesTrendsStore();

  return (
    <FilterContainer
      resetFilterHandler={() =>
        s.setParams({ preset: "12months", startDate: "", endDate: "" })
      }
    >
      <Field label="Произвольный диапазон" htmlFor="trends-period">
        <DateRangeField
          id="trends-period"
          value={{ from: s.startDate, to: s.endDate }}
          onChange={({ from, to }) =>
            s.setParams({ startDate: from, endDate: to })
          }
          clearable={false}
        />
      </Field>
    </FilterContainer>
  );
};

export default TrendsFilter;
