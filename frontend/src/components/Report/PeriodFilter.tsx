import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";
import SwitchField from "@/components/app/SwitchField";
import { Input } from "@/components/ui/input";

// Тело Sheet-фильтра отчёта: произвольный период двумя нативными датами.
// «Сбросить» возвращает текущий месяц — дефолт отчётов (у архива это прошлый:
// там текущий месяц ещё «не история»). Свитч «только согласованные работы»
// живёт здесь же: он влияет на все режимы отчёта «Сотрудники», а не на одну
// секцию, поэтому его место — в фильтре, а не в подвале одного из режимов.
const PeriodFilter = ({
  idPrefix,
  from,
  to,
  onChange,
  onReset,
  approvedOnly,
  onApprovedOnlyChange,
}: {
  /** Префикс id полей — на странице может быть несколько фильтров. */
  idPrefix: string;
  from: string;
  to: string;
  onChange: (patch: { from?: string; to?: string }) => void;
  onReset: () => void;
  approvedOnly?: boolean;
  onApprovedOnlyChange?: (value: boolean) => void;
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
    {onApprovedOnlyChange && (
      <SwitchField
        id={`${idPrefix}-approved-only`}
        checked={Boolean(approvedOnly)}
        onCheckedChange={onApprovedOnlyChange}
        label="Только согласованные работы"
        hint="Учитывать лишь работы из утверждённых отчётов по услугам. Влияет на все режимы отчёта."
      />
    )}
  </FilterContainer>
);

export default PeriodFilter;
