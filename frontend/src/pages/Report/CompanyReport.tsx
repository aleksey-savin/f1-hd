import { useEffect, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { RiFilter3Line } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import MonthStepper from "@/components/app/MonthStepper";
import { Eyebrow } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";
import { cn } from "@/lib/utils";

import {
  AttributionNote,
  CardCrumbs,
  CardMonogram,
  CardSkeleton,
  CategorySection,
  MonthsSection,
  ScopeNote,
} from "../../components/Report/CardSections";
import ClassLegend from "../../components/Report/ClassLegend";
import EmptyReport from "../../components/Report/EmptyReport";
import FilterSheet from "../../components/Report/FilterSheet";
import KpiRow from "../../components/Report/KpiRow";
import PeriodFilter from "../../components/Report/PeriodFilter";
import PageShell from "@/components/app/PageShell";
import ShareBars from "../../components/Report/ShareBars";
import StackedTimeBars, {
  type StackedTimeRow,
} from "../../components/Report/StackedTimeBars";
import SubdivisionsTable from "../../components/Report/SubdivisionsTable";
import useCompaniesSummaryStore from "../../store/reports/companies-summary";
import useCompanyCardStore from "../../store/reports/company-card";
import type { CompanyCardResponse } from "../../types/report";
import { isFullMonthRange } from "../../util/period";

// Карточка компании — второй уровень отчёта «Компании». Анатомия карточки
// сущности: крошки → hero → секции-панели. Отвечает на «что мы делали для
// этого клиента»: сколько времени, по каким подразделениям, каким категориям
// заявок, кто из наших работал и как это менялось за год.

const CompanyReport = () => {
  const { companyId } = useParams();
  const navigate = useNavigate();
  const s = useCompanyCardStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();

  // Период приходит из сводки: переход «сводка → карточка» не должен
  // сбрасывать выбранный месяц
  useEffect(() => {
    const summary = useCompaniesSummaryStore.getState();
    if (!companyId) return;
    s.open({ companyId, from: summary.from, to: summary.to });
    window.scrollTo(0, 0);
  }, [companyId]);

  const data =
    s.data && !("subdivision" in s.data)
      ? (s.data as CompanyCardResponse)
      : null;
  const filterActive = !isFullMonthRange(s.from, s.to);

  const toolbar = (
    <>
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
      {data && (
        <Button asChild variant="outline">
          <Link to={`/companies/${data.company._id}`}>
            Открыть карточку компании
          </Link>
        </Button>
      )}
    </>
  );

  let body: ReactNode;
  if (s.isForbidden) {
    body = (
      <EmptyReport
        title="Отчёт по этой компании недоступен"
        hint="Данные компании видят ответственные лица с её стороны и наши сотрудники. Если доступ нужен по работе, попросите администратора указать вас в карточке компании."
      />
    );
  } else if (!data) {
    body = s.error ? (
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
    ) : (
      <CardSkeleton />
    );
  } else if (data.totals.totalWorks === 0) {
    body = (
      <EmptyReport
        title="Нет работ за период"
        hint="За выбранный период по этой компании не зафиксировано ни одной завершённой работы. Полистайте месяцы стрелками или задайте период в фильтре."
        action={
          <Button variant="outline" onClick={() => s.resetPeriod()}>
            Текущий месяц
          </Button>
        }
      />
    );
  } else {
    const subdivisionRows: StackedTimeRow[] = data.subdivisions.map(
      (subdivision) => ({
        key: subdivision._id,
        name: subdivision.name,
        onSite: subdivision.onSite.time,
        remote: subdivision.remote.time,
        routineTask: subdivision.routineTask.time,
      }),
    );
    if (data.unassigned && data.unassigned.totalTime > 0) {
      subdivisionRows.push({
        key: "__unassigned",
        name: "Без подразделения",
        onSite: 0,
        remote: 0,
        routineTask: 0,
        other: data.unassigned.totalTime,
      });
    }

    body = (
      <div className={cn("transition-opacity", s.isLoading && "opacity-60")}>
        {data.scopeLimited && (
          <ScopeNote>
            Вы видите данные своих подразделений — итог по компании целиком
            доступен ответственным лицам с её стороны.
          </ScopeNote>
        )}

        <KpiRow
          totals={data.totals}
          prev={data.prev.totals}
          busy={s.isLoading}
        />

        {subdivisionRows.length > 0 && (
          <>
            <Eyebrow count={data.subdivisions.length} action={<ClassLegend />}>
              Время по подразделениям
            </Eyebrow>
            <div className="rounded-xl border border-border bg-card p-5">
              <StackedTimeBars rows={subdivisionRows} />
              <AttributionNote diagnostics={data.diagnostics} />
            </div>

            <Eyebrow
              count={data.subdivisions.length}
              action={
                <span className="text-sm font-normal text-faint">
                  строка ведёт в карточку подразделения
                </span>
              }
            >
              Сводка по подразделениям
            </Eyebrow>
            <div className="overflow-x-auto rounded-xl border border-border bg-card px-2 py-1.5">
              <SubdivisionsTable
                subdivisions={data.subdivisions}
                unassigned={data.unassigned}
                totals={data.totals}
                onOpen={(subdivisionId) =>
                  navigate(
                    `/report/companies/${data.company._id}/subdivisions/${subdivisionId}`,
                  )
                }
              />
            </div>
          </>
        )}

        <div className="grid gap-x-6 lg:grid-cols-2">
          <CategorySection categories={data.byCategory} />
          <div>
            <Eyebrow count={data.executors.length}>Кто обслуживал</Eyebrow>
            <div className="rounded-xl border border-border bg-card p-5">
              <ShareBars
                unit="ms"
                rows={data.executors.map((executor) => ({
                  key: executor._id,
                  label: executor.name,
                  value: executor.time,
                }))}
              />
            </div>
          </div>
        </div>

        <MonthsSection months={data.byMonth} />
      </div>
    );
  }

  return (
    <PageShell
      title={data?.company.alias ?? "Компания"}
      subtitle={
        data && (
          <span className="flex flex-wrap items-center gap-x-2">
            {data.company.fullTitle}
            {data.company.subdivisionsCount > 0 && (
              <>
                <span className="text-faint">·</span>
                {data.company.subdivisionsCount} подразделений
              </>
            )}
          </span>
        )
      }
      icon={data && <CardMonogram name={data.company.alias} />}
      breadcrumb={
        <CardCrumbs
          items={[
            {
              label: "Компании",
              // У кого доступен ровно один объект, сводка сразу редиректит
              // сюда же — ссылка в крошках была бы кнопкой в никуда
              to: data?.scope.defaultView ? undefined : "/report/companies",
            },
          ]}
        />
      }
      toolbar={toolbar}
    >
      <FilterSheet>
        <PeriodFilter
          idPrefix="company-card"
          from={s.from}
          to={s.to}
          onChange={(patch) => s.setPeriod(patch)}
          onReset={() => s.resetPeriod()}
        />
      </FilterSheet>
      {body}
    </PageShell>
  );
};

export default CompanyReport;

export function loader() {
  document.title = "Отчёт по компании";
  return null;
}
