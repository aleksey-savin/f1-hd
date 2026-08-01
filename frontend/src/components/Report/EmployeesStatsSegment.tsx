import { type ReactNode } from "react";

import { Eyebrow } from "@/components/app/Panel";
import StatTile, { StatTileDelta } from "@/components/app/StatTile";
import { cn } from "@/lib/utils";

import type { EmployeesSummaryResponse } from "../../types/employeesReport";

import ClassLegend from "./ClassLegend";
import EmployeesCards from "./EmployeesCards";
import EmployeesTable from "./EmployeesTable";
import ShareBars from "./ShareBars";
import StackedTimeBars, { type StackedTimeRow } from "./StackedTimeBars";
import { deltaOf } from "./delta";
import { formatMinutes } from "./work-format";

// Режим «Статистика»: чем занималась команда за период. Раньше эти цифры жили
// в срезе «Сотрудники» отчёта «Аналитика» — предмет отчёта о людях вернулся в
// отчёт о людях.

const HINT = "к прошлому периоду";
const MAX_BAR_ROWS = 10;

const employeeBars = (data: EmployeesSummaryResponse): StackedTimeRow[] => {
  const withWorks = data.employees.filter((row) => row.totalMinutes > 0);
  const top = withWorks.slice(0, MAX_BAR_ROWS);
  const rest = withWorks.slice(MAX_BAR_ROWS);

  const rows: StackedTimeRow[] = top.map((row) => ({
    key: row.employee._id,
    name: `${row.employee.lastName} ${row.employee.firstName.charAt(0)}.`,
    onSite: row.onSite.minutes,
    remote: row.remote.minutes,
    routineTask: row.routineTask.minutes,
  }));

  if (rest.length > 0) {
    rows.push({
      key: "__other",
      name: `Прочие (${rest.length})`,
      onSite: 0,
      remote: 0,
      routineTask: 0,
      other: rest.reduce((sum, row) => sum + row.totalMinutes, 0),
    });
  }

  return rows;
};

const Panel = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-5">{children}</div>
);

const EmployeesStatsSegment = ({
  data,
  busy,
  currentUserId,
}: {
  data: EmployeesSummaryResponse;
  busy: boolean;
  currentUserId?: string;
}) => {
  const { totals, prev } = data;
  const utilization =
    totals.normMinutes > 0
      ? Math.round((totals.totalMinutes / totals.normMinutes) * 100)
      : null;
  const prevUtilization =
    prev.totals.normMinutes > 0
      ? Math.round((prev.totals.totalMinutes / prev.totals.normMinutes) * 100)
      : null;

  return (
    <div className={cn("transition-opacity", busy && "opacity-60")}>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
        <StatTile
          label="Отработано"
          busy={busy}
          value={formatMinutes(totals.totalMinutes)}
          delta={
            <StatTileDelta
              {...deltaOf(totals.totalMinutes, prev.totals.totalMinutes)}
              hint={HINT}
            />
          }
          footer={`${totals.employeesWithWorks} из ${totals.employeesCount} сотрудников · ${totals.worksCount} работ`}
        />
        <StatTile
          label="Заявок закрыто"
          busy={busy}
          value={totals.ticketsFinished}
          delta={
            <StatTileDelta
              {...deltaOf(totals.ticketsFinished, prev.totals.ticketsFinished)}
              hint={HINT}
            />
          }
          footer={`по ${totals.worksCount} работам · ${totals.onSite.count} выездов`}
        />
        <StatTile
          label="Работы"
          busy={busy}
          value={totals.worksCount}
          delta={
            <StatTileDelta
              {...deltaOf(totals.worksCount, prev.totals.worksCount)}
              hint={HINT}
            />
          }
          footer={`Выезды ${totals.onSite.count} · Удалённо ${totals.remote.count} · Регламент ${totals.routineTask.count}`}
        />
        <StatTile
          label="Загрузка"
          busy={busy}
          value={utilization === null ? "—" : `${utilization}%`}
          delta={
            // Разница долей — в пунктах: процент от процента ничего не значит
            <StatTileDelta
              direction={
                utilization === null || prevUtilization === null
                  ? "flat"
                  : utilization > prevUtilization
                    ? "up"
                    : utilization < prevUtilization
                      ? "down"
                      : "flat"
              }
              percentage={
                utilization === null || prevUtilization === null
                  ? null
                  : utilization - prevUtilization
              }
              unit=" п.п."
              hint={HINT}
            />
          }
          footer={`норма ${formatMinutes(totals.normMinutes)} по личным графикам`}
        />
      </div>

      <Eyebrow count={totals.employeesWithWorks} action={<ClassLegend />}>
        Время по сотрудникам
      </Eyebrow>
      <Panel>
        <StackedTimeBars rows={employeeBars(data)} unit="minutes" />
      </Panel>

      <div className="grid gap-x-6 lg:grid-cols-2">
        <div>
          <Eyebrow count={data.byCompany.length}>По компаниям</Eyebrow>
          <Panel>
            <ShareBars
              rows={data.byCompany.map((company) => ({
                key: company._id ?? "none",
                label: company.alias,
                value: company.minutes,
              }))}
            />
          </Panel>
        </div>
        <div>
          <Eyebrow count={data.byCategory.length}>По категориям заявок</Eyebrow>
          <Panel>
            <ShareBars
              rows={data.byCategory.map((category) => ({
                key: category._id ?? "none",
                label: category.title,
                value: category.minutes,
              }))}
            />
          </Panel>
        </div>
      </div>

      <Eyebrow
        count={totals.employeesCount}
        action={
          <span className="text-sm font-normal text-faint">
            строка ведёт в отчёт сотрудника
          </span>
        }
      >
        Сводка за период
      </Eyebrow>
      <div className="rounded-xl border border-border bg-card">
        <div className="hidden overflow-x-auto px-2 py-1.5 md:block">
          <EmployeesTable
            variant="stats"
            employees={data.employees}
            totals={totals}
            currentUserId={currentUserId}
          />
        </div>
        <div className="md:hidden">
          <EmployeesCards
            variant="stats"
            employees={data.employees}
            currentUserId={currentUserId}
          />
        </div>
      </div>
    </div>
  );
};

export default EmployeesStatsSegment;
