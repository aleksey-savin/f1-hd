import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { RiFilter3Line } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import MonthStepper from "@/components/app/MonthStepper";
import { Eyebrow } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";
import { cn } from "@/lib/utils";

import useCompaniesSummaryStore from "../../store/reports/companies-summary";
import type { CompanyRow } from "../../types/report";
import { isFullMonthRange } from "../../util/period";

import ClassLegend from "./ClassLegend";
import EmptyReport from "./EmptyReport";
import ExportMenu from "./ExportMenu";
import FilterSheet from "./FilterSheet";
import KpiRow from "./KpiRow";
import PageShell from "@/components/app/PageShell";
import StackedTimeBars, { type StackedTimeRow } from "./StackedTimeBars";
import SummaryFilter from "./SummaryFilter";
import { CompanySummaryTable } from "./SummaryTables";

// Сегмент «Сводка» отчёта «Компании»: KPI-ряд с дельтами к прошлому периоду →
// время по компаниям → таблица, строка которой ведёт в карточку компании.
// Среза «по сотрудникам» здесь больше нет — он стал отчётом «Сотрудники».

// В графике — топ-10 полос, хвост сворачивается в серые «Прочие»
const MAX_BAR_ROWS = 10;

const companyBarRows = (companies: CompanyRow[]): StackedTimeRow[] => {
  const sorted = [...companies].sort((a, b) => b.totalTime - a.totalTime);
  const top = sorted.slice(0, MAX_BAR_ROWS);
  const rest = sorted.slice(MAX_BAR_ROWS);

  const rows: StackedTimeRow[] = top.map((company) => ({
    key: company.company._id,
    name: company.company.alias,
    onSite: company.onSite.time,
    remote: company.remote.time,
    routineTask: company.routineTask.time,
  }));

  if (rest.length > 0) {
    rows.push({
      key: "__other",
      name: `Прочие (${rest.length})`,
      onSite: 0,
      remote: 0,
      routineTask: 0,
      other: rest.reduce((sum, company) => sum + company.totalTime, 0),
    });
  }

  return rows;
};

// Панель-обёртка таблиц: горизонтальный скролл внутри, страница не «плывёт»
const TablePanel = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto rounded-xl border border-border bg-card px-2 py-1.5">
    {children}
  </div>
);

const SummarySegment = ({ segment }: { segment: ReactNode }) => {
  const s = useCompaniesSummaryStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const navigate = useNavigate();

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
      <MonthStepper
        from={s.from}
        to={s.to}
        onChange={(range) => s.setPeriod(range)}
      />
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

  const errorBanner = s.error && (
    <AlertMessage
      variant="danger"
      message={
        <span className="flex flex-wrap items-center gap-3">
          {s.error}
          <Button variant="outline" size="xs" onClick={() => s.fetch()}>
            Повторить
          </Button>
        </span>
      }
    />
  );

  let body: ReactNode;
  if (!data) {
    body = s.error ? (
      errorBanner
    ) : (
      // Первая загрузка — скелет раскладки
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  } else if (data.scope.kind === "none") {
    // Право на отчёт есть, а роли нет: объясняем словами, а не пустым экраном
    body = (
      <EmptyReport
        title="Отчёт вам пока недоступен"
        hint="Данные видят ответственные лица со стороны компании и руководители подразделений. Если отчёт нужен по работе, попросите администратора указать вас в карточке компании или подразделения."
      />
    );
  } else if (data.companies.length === 0) {
    body = (
      <>
        {errorBanner}
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
    body = (
      <div className={cn("transition-opacity", s.isLoading && "opacity-60")}>
        {errorBanner}

        <KpiRow
          totals={data.totals}
          prev={data.prev.totals}
          busy={s.isLoading}
        />

        <Eyebrow count={data.companies.length} action={<ClassLegend />}>
          Время по компаниям
        </Eyebrow>
        <div className="rounded-xl border border-border bg-card p-5">
          <StackedTimeBars rows={companyBarRows(data.companies)} />
        </div>

        <Eyebrow
          count={data.companies.length}
          action={
            <span className="text-sm font-normal text-faint">
              строка ведёт в карточку компании
            </span>
          }
        >
          Сводка по компаниям
        </Eyebrow>
        <TablePanel>
          <CompanySummaryTable
            companies={data.companies}
            totals={data.totals}
            onOpen={(companyId) => navigate(`/report/companies/${companyId}`)}
          />
        </TablePanel>
      </div>
    );
  }

  return (
    <PageShell title="Компании" toolbar={toolbar}>
      <FilterSheet>
        <SummaryFilter />
      </FilterSheet>
      {body}
    </PageShell>
  );
};

export default SummarySegment;
