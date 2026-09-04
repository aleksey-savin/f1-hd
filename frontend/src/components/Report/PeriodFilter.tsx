import DateRangeField from "@/components/app/DateRangeField";
import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";
import SwitchField from "@/components/app/SwitchField";

// Тело Sheet-фильтра отчёта: произвольный период одним полем-календарём.
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
    <Field label="Период" htmlFor={`${idPrefix}-period`}>
      <DateRangeField
        id={`${idPrefix}-period`}
        value={{ from, to }}
        onChange={onChange}
      />
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
