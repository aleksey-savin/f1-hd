import { useEffect, type ReactNode } from "react";
import { RiFilter3Line } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import MonthStepper from "@/components/app/MonthStepper";
import { Eyebrow } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";
import { cn } from "@/lib/utils";

import useAnalyticsSummaryStore from "../../store/reports/analytics-summary";
import type { CompanySummary } from "../../types/report";
import { isFullMonthRange } from "../../util/period";

import ClassLegend from "./ClassLegend";
import EmptyReport from "./EmptyReport";
import ExportMenu from "./ExportMenu";
import FilterSheet from "./FilterSheet";
import KpiRow from "./KpiRow";
import ReportShell from "./ReportShell";
import StackedTimeBars, { type StackedTimeRow } from "./StackedTimeBars";
import SummaryFilter from "./SummaryFilter";
import {
  ClientSummaryTable,
  CompanySummaryTable,
  EmployeeTable,
} from "./SummaryTables";
import { aggregateExecutors } from "./employees";

// Сегмент «Сводка»: KPI-ряд с дельтами к прошлому периоду → разрез
// «Компании | Сотрудники» (стек-бар + таблица с раскрытием) либо клиентский
// вид (подразделения своей компании). Данные грузятся сразу за текущий месяц;
// при ошибке устаревший отчёт остаётся под баннером.

// В графике — топ-10 полос, хвост сворачивается в серые «Прочие»
const MAX_BAR_ROWS = 10;

const toBarRows = (
  entries: { key: string; name: string; onSite: number; remote: number; routineTask: number; total: number }[],
): StackedTimeRow[] => {
  const sorted = [...entries].sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, MAX_BAR_ROWS);
  const rest = sorted.slice(MAX_BAR_ROWS);
  const rows: StackedTimeRow[] = top.map(({ total: _total, ...row }) => row);
  if (rest.length > 0) {
    rows.push({
      key: "__other",
      name: `Прочие (${rest.length})`,
      onSite: 0,
      remote: 0,
      routineTask: 0,
      other: rest.reduce((sum, row) => sum + row.total, 0),
    });
  }
  return rows;
};

const companyBarRows = (companies: CompanySummary[]) =>
  toBarRows(
    companies.map((company) => ({
      key: company.company._id,
      name: company.company.alias,
      onSite: company.onSite.time,
      remote: company.remote.time,
      routineTask: company.routineTask.time,
      total: company.totalTime,
    })),
  );

// Панель-обёртка таблиц: горизонтальный скролл внутри, страница не «плывёт»
const TablePanel = ({ children }: { children: ReactNode }) => (
  <div className="tw:overflow-x-auto tw:rounded-xl tw:border tw:border-border tw:bg-card tw:px-2 tw:py-1.5">
    {children}
  </div>
);

const SummarySegment = ({ segment }: { segment: ReactNode }) => {
  const s = useAnalyticsSummaryStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();

  // Первичная загрузка (и освежение при возврате на сегмент); смена периода
  // делает запросы сама
  useEffect(() => {
    s.fetch();
  }, []);

  const filterActive = !isFullMonthRange(s.from, s.to);
  const data = s.data;

  const toolbar = (
    <>
      {segment}
      <MonthStepper from={s.from} to={s.to} onChange={(range) => s.setPeriod(range)} />
      <Button
        variant={filterActive ? "success" : "outline"}
        size="icon"
        onClick={filterOffcanvas.handleShow}
        title="Фильтр"
        aria-label="Фильтр"
      >
        <RiFilter3Line />
      </Button>
      <ExportMenu data={data} />
    </>
  );

  let body: ReactNode;
  if (!data) {
    body = s.error ? (
      <AlertMessage
        variant="danger"
        message={
          <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-3">
            {s.error}
            <Button variant="outline" size="xs" onClick={() => s.fetch()}>
              Повторить
            </Button>
          </span>
        }
      />
    ) : (
      // Первая загрузка — скелет раскладки
      <div className="tw:space-y-6">
        <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:xl:grid-cols-4 tw:xl:gap-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="tw:h-28 tw:rounded-xl" />
          ))}
        </div>
        <Skeleton className="tw:h-72 tw:rounded-xl" />
        <Skeleton className="tw:h-64 tw:rounded-xl" />
      </div>
    );
  } else if (data.companies.length === 0) {
    body = (
      <>
        {s.error && <AlertMessage variant="danger" message={s.error} />}
        <EmptyReport
          title="Нет работ за период"
          hint="За выбранный период не зафиксировано ни одной завершённой работы. Полистайте месяцы стрелками или задайте период в фильтре."
          action={
            <Button variant="outline" onClick={() => s.resetPeriod()}>
              Текущий месяц
            </Button>
          }
        />
      </>
    );
  } else {
    const isClient = data.isClientView;
    const employees = isClient ? [] : aggregateExecutors(data.companies);
    const subdivisions = isClient
      ? (data.companies[0]?.subdivisions ?? []).filter(
          (subdivision) => subdivision.totalWorks > 0,
        )
      : [];

    body = (
      <div
        className={cn(
          "tw:transition-opacity",
          s.isLoading && "tw:opacity-60",
        )}
      >
        {s.error && (
          <AlertMessage
            variant="danger"
            message={
              <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-3">
                {s.error}
                <Button variant="outline" size="xs" onClick={() => s.fetch()}>
                  Повторить
                </Button>
              </span>
            }
          />
        )}

        <KpiRow
          totals={data.totals}
          prev={data.prev.totals}
          busy={s.isLoading}
          showAverage={!isClient}
        />

        {isClient ? (
          <>
            <Eyebrow
              count={subdivisions.length}
              action={<ClassLegend />}
            >
              Время по подразделениям
            </Eyebrow>
            <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
              <StackedTimeBars
                rows={subdivisions.map((subdivision) => ({
                  key: subdivision._id,
                  name: subdivision.name,
                  onSite: subdivision.onSiteTime,
                  remote: subdivision.remoteTime,
                  routineTask: subdivision.routineTaskTime,
                }))}
              />
            </div>

            <Eyebrow>Сводка по подразделениям</Eyebrow>
            <TablePanel>
              <ClientSummaryTable
                subdivisions={subdivisions}
                totals={data.totals}
              />
            </TablePanel>
          </>
        ) : (
          <>
            {/* Разрез — второй уровень: KPI выше от него не зависят */}
            <div className="tw:mt-7 tw:mb-2.5 tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-2">
              <Segmented
                ariaLabel="Разрез сводки"
                options={[
                  { value: "companies", label: "Компании" },
                  { value: "employees", label: "Сотрудники" },
                ]}
                value={s.viewType}
                onChange={(value) =>
                  s.setViewType(value as "companies" | "employees")
                }
              />
              <ClassLegend className="tw:ms-auto" />
            </div>

            {s.viewType === "companies" ? (
              <>
                <Eyebrow count={data.companies.length}>
                  Время по компаниям
                </Eyebrow>
                <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
                  <StackedTimeBars rows={companyBarRows(data.companies)} />
                </div>

                <Eyebrow count={data.companies.length}>
                  Сводка по компаниям
                </Eyebrow>
                <TablePanel>
                  <CompanySummaryTable
                    companies={data.companies}
                    totals={data.totals}
                  />
                </TablePanel>
              </>
            ) : (
              <>
                <Eyebrow count={employees.length}>
                  Время по сотрудникам
                </Eyebrow>
                <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
                  <StackedTimeBars
                    rows={toBarRows(
                      employees.map((employee) => ({
                        key: employee.name,
                        name: employee.name,
                        onSite: employee.onSiteTime,
                        remote: employee.remoteTime,
                        routineTask: employee.routineTaskTime,
                        total: employee.totalTime,
                      })),
                    )}
                  />
                </div>

                <Eyebrow count={employees.length}>
                  Сводка по сотрудникам
                </Eyebrow>
                <TablePanel>
                  <EmployeeTable employees={employees} totals={data.totals} />
                </TablePanel>
              </>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <ReportShell title="Аналитика" toolbar={toolbar}>
      <FilterSheet>
        <SummaryFilter />
      </FilterSheet>
      {body}
    </ReportShell>
  );
};

export default SummarySegment;
