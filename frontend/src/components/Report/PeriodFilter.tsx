import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";
import { Input } from "@/components/ui/input";

// Тело Sheet-фильтра отчёта: произвольный период двумя нативными датами.
// «Сбросить» возвращает текущий месяц — дефолт отчётов (у архива это прошлый:
// там текущий месяц ещё «не история»).
const PeriodFilter = ({
  idPrefix,
  from,
  to,
  onChange,
  onReset,
}: {
  /** Префикс id полей — на странице может быть несколько фильтров. */
  idPrefix: string;
  from: string;
  to: string;
  onChange: (patch: { from?: string; to?: string }) => void;
  onReset: () => void;
}) => (
  <FilterContainer resetFilterHandler={onReset}>
    <Field label="Период" htmlFor={`${idPrefix}-period-from`}>
      <div className="tw:grid tw:grid-cols-2 tw:gap-2">
        <Input
          id={`${idPrefix}-period-from`}
          type="date"
          aria-label="Начало периода"
          value={from}
          max={to || undefined}
          onChange={(event) => onChange({ from: event.target.value })}
        />
        <Input
          id={`${idPrefix}-period-to`}
          type="date"
          aria-label="Конец периода"
          value={to}
          min={from || undefined}
          onChange={(event) => onChange({ to: event.target.value })}
        />
      </div>
    </Field>
  </FilterContainer>
);

export default PeriodFilter;
