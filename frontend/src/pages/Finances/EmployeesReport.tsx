import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { RiFilter3Line } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import MonthStepper from "@/components/app/MonthStepper";
import Segmented from "@/components/app/Segmented";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";

import EmployeesOvertimeSegment from "../../components/Report/EmployeesOvertimeSegment";
import EmployeesStatsSegment from "../../components/Report/EmployeesStatsSegment";
import EmployeesTrendsSegment from "../../components/Report/EmployeesTrendsSegment";
import EmptyReport from "../../components/Report/EmptyReport";
import FilterSheet from "../../components/Report/FilterSheet";
import PeriodFilter from "../../components/Report/PeriodFilter";
import PageShell from "@/components/app/PageShell";
import { useAuthedUser } from "../../store/authed-user";
import useEmployeesSummaryStore from "../../store/reports/employees-summary";
import { isFullMonthRange } from "../../util/period";

// «Сотрудники» — отчёт о команде в трёх режимах: «Статистика» (чем занимались),
// «Переработки» (норма, Δ, доплата) и «Динамика» (12 месяцев). До этого главный
// экран отвечал только на «сколько доплатить», а содержательная статистика
// жила либо в карточке сотрудника, либо в чужом отчёте «Аналитика».
// Канон «Архива»: сегмент несёт query (?view=), у каждого режима свой стор.

type View = "stats" | "overtime" | "trends";

const VIEWS: { value: View; label: string }[] = [
  { value: "stats", label: "Статистика" },
  { value: "overtime", label: "Переработки" },
  { value: "trends", label: "Динамика" },
];

const EmployeesReport = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const s = useEmployeesSummaryStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const authedUser = useAuthedUser();

  const requested = searchParams.get("view");
  const view: View = VIEWS.some((item) => item.value === requested)
    ? (requested as View)
    : "stats";

  useEffect(() => {
    s.fetch();
  }, []);

  const switchView = (value: string) => {
    setSearchParams(value === "stats" ? {} : { view: value }, {
      replace: true,
    });
    // Смена query не меняет pathname — скролл-ресеты Root не срабатывают
    window.scrollTo(0, 0);
    document.querySelector(".mobile-shell__scroll")?.scrollTo(0, 0);
  };

  const filterActive = !isFullMonthRange(s.from, s.to) || s.approvedOnly;
  const data = s.data;

  const toolbar = (
    <>
      <Segmented
        ariaLabel="Режим отчёта"
        options={VIEWS}
        value={view}
        onChange={switchView}
      />
      {/* «Динамика» всегда показывает последние 12 месяцев — период к ней
          не применяется, и степпер там только сбивал бы с толку */}
      {view !== "trends" && (
        <MonthStepper
          from={s.from}
          to={s.to}
          onChange={(range) => s.setPeriod(range)}
        />
      )}
      <Button
        variant={filterActive ? "success" : "outline"}
        size="icon"
        onClick={filterOffcanvas.handleShow}
        title="Фильтр"
        aria-label="Фильтр"
      >
        <RiFilter3Line />
      </Button>
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
  if (view === "trends") {
    body = (
      <>
        {errorBanner}
        <EmployeesTrendsSegment approvedOnly={s.approvedOnly} />
      </>
    );
  } else if (!data) {
    body = s.error ? (
      errorBanner
    ) : (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  } else if (data.totals.worksCount === 0) {
    body = (
      <>
        {errorBanner}
        <EmptyReport
          title="Нет работ за период"
          hint="За выбранный период сотрудники не зафиксировали ни одной завершённой работы. Полистайте месяцы стрелками или задайте период в фильтре."
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
      <>
        {errorBanner}
        {view === "overtime" ? (
          <EmployeesOvertimeSegment
            data={data}
            busy={s.isLoading}
            currentUserId={authedUser?._id}
          />
        ) : (
          <EmployeesStatsSegment
            data={data}
            busy={s.isLoading}
            currentUserId={authedUser?._id}
          />
        )}
      </>
    );
  }

  return (
    <PageShell title="Сотрудники" toolbar={toolbar}>
      <FilterSheet>
        <PeriodFilter
          idPrefix="employees"
          from={s.from}
          to={s.to}
          onChange={(patch) => s.setPeriod(patch)}
          onReset={() => s.resetPeriod()}
          approvedOnly={s.approvedOnly}
          onApprovedOnlyChange={(value) => s.setApprovedOnly(value)}
        />
      </FilterSheet>
      {body}
    </PageShell>
  );
};

export default EmployeesReport;

export function loader() {
  document.title = "Сотрудники";
  return null;
}
