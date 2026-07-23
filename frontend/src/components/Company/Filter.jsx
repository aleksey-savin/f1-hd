import { useMemo } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import Field from "@/components/app/Field";
import FilterContainer from "@/components/app/FilterContainer";
import SwitchField from "@/components/app/SwitchField";

import useCompanyFilterStore, {
  getResponsibleId,
} from "../../store/lists/companies";

// Sheet-фильтр справочника компаний: «Ответственный» (мультивыбор со
// счётчиками, включая «Без ответственного») и «Только с подключёнными
// услугами». Быстрый срез «Все | Мои» — сегментом в строке инструментов.
const CompanyFilter = () => {
  const s = useCompanyFilterStore();

  // Список ответственных собираем из выборки; счётчики — по всему видимому
  // набору (не по отфильтрованному — числа не «пляшут» при выборе).
  const { options, withoutCount } = useMemo(() => {
    const byId = new Map();
    let without = 0;
    (s.originalList ?? []).forEach((company) => {
      const responsibles = company.responsibles ?? [];
      if (!responsibles.length) without += 1;
      responsibles.forEach((resp) => {
        const id = getResponsibleId(resp);
        if (!id) return;
        const existing = byId.get(id);
        if (existing) {
          existing.count += 1;
        } else {
          byId.set(id, {
            id,
            name:
              `${resp.lastName ?? ""} ${resp.firstName ?? ""}`.trim() || "—",
            count: 1,
          });
        }
      });
    });
    return {
      options: [...byId.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      withoutCount: without,
    };
  }, [s.originalList]);

  const row = (key, checked, onToggle, label, count) => (
    <label
      key={key}
      className="tw:flex tw:cursor-pointer tw:items-center tw:gap-2.5 tw:py-1.5 tw:text-sm"
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="tw:min-w-0 tw:flex-1 tw:truncate">{label}</span>
      <span className="tw:flex-none tw:text-sm tw:text-faint tw:tabular-nums">
        {count}
      </span>
    </label>
  );

  return (
    <FilterContainer resetFilterHandler={s.resetFilter}>
      <Field label="Ответственный">
        <div className="tw:flex tw:flex-col">
          {options.map((resp) =>
            row(
              resp.id,
              s.responsibles.includes(resp.id),
              () => s.toggleResponsible(resp.id),
              resp.name,
              resp.count,
            ),
          )}
          {withoutCount > 0 &&
            row(
              "no-responsible",
              s.noResponsible,
              () => s.toggleNoResponsible(),
              "Без ответственного",
              withoutCount,
            )}
        </div>
      </Field>

      <SwitchField
        id="filter-with-services"
        checked={!!s.onlyWithServices}
        onCheckedChange={(value) => s.setOnlyWithServices(value)}
        label="Только с подключёнными услугами"
        hint="Компании, у которых есть хотя бы одна услуга."
        divider
      />

      <SwitchField
        id="filter-active-companies"
        checked={!!s.activeOnly}
        onCheckedChange={(value) => s.setActiveOnly(value)}
        label="Только активные"
        hint="Выключите, чтобы увидеть отключённые компании."
        divider
      />
    </FilterContainer>
  );
};

export default CompanyFilter;
