import { useEffect, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { RiFilter3Line } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import MonthStepper from "@/components/app/MonthStepper";
import { Eyebrow } from "@/components/app/Panel";
import SwitchField from "@/components/app/SwitchField";
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
import ReportShell from "../../components/Report/ReportShell";
import ShareBars from "../../components/Report/ShareBars";
import StackedTimeBars, {
  type StackedTimeRow,
} from "../../components/Report/StackedTimeBars";
import SubdivisionsTable from "../../components/Report/SubdivisionsTable";
import useCompaniesSummaryStore from "../../store/reports/companies-summary";
import useCompanyCardStore from "../../store/reports/company-card";
import type { SubdivisionCardResponse } from "../../types/report";
import { isFullMonthRange } from "../../util/period";

// Карточка подразделения — третий уровень отчёта «Компании». Здесь меняется
// оптика: вместо «кто из наших обслуживал» — «кто обращался», потому что
// подразделение это структура клиента, а не наша.

const declOfTickets = (count: number) => {
  const tail = count % 10;
  const teens = count % 100;
  if (tail === 1 && teens !== 11) return "заявка";
  if (tail >= 2 && tail <= 4 && (teens < 12 || teens > 14)) return "заявки";
  return "заявок";
};

const SubdivisionReport = () => {
  const { companyId, subdivisionId } = useParams();
  const navigate = useNavigate();
  const s = useCompanyCardStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();

  useEffect(() => {
    const summary = useCompaniesSummaryStore.getState();
    if (!companyId || !subdivisionId) return;
    s.open({ companyId, subdivisionId, from: summary.from, to: summary.to });
    window.scrollTo(0, 0);
  }, [companyId, subdivisionId]);

  const data =
    s.data && "subdivision" in s.data ? (s.data as SubdivisionCardResponse) : null;
  const filterActive = !isFullMonthRange(s.from, s.to);

  const toolbar = (
    <>
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
    </>
  );

  let body: ReactNode;
  if (s.isForbidden) {
    body = (
      <EmptyReport
        title="Отчёт по этому подразделению недоступен"
        hint="Данные подразделения видят его руководитель и ответственные лица компании. Если доступ нужен по работе, попросите администратора указать вас руководителем подразделения."
      />
    );
  } else if (!data) {
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
      <CardSkeleton />
    );
  } else if (data.totals.totalWorks === 0) {
    body = (
      <EmptyReport
        title="Нет работ за период"
        hint="За выбранный период по этому подразделению не зафиксировано ни одной завершённой работы. Полистайте месяцы стрелками или задайте период в фильтре."
        action={
          <Button variant="outline" onClick={() => s.resetPeriod()}>
            Текущий месяц
          </Button>
        }
      />
    );
  } else {
    const childRows: StackedTimeRow[] = data.children.map((child) => ({
      key: child._id,
      name: child.name,
      onSite: child.onSite.time,
      remote: child.remote.time,
      routineTask: child.routineTask.time,
    }));

    body = (
      <div className={cn("tw:transition-opacity", s.isLoading && "tw:opacity-60")}>
        {data.access === "partial" && (
          <ScopeNote>
            Отчёт открыт вам как руководителю подразделения «{data.subdivision.name}» —
            в нём работы по заявкам его сотрудников и вложенных подразделений.
            Полный отчёт по компании доступен ответственным лицам.
          </ScopeNote>
        )}

        {data.subdivision.childrenCount > 0 && (
          <div className="tw:mb-5 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:px-5 tw:py-3.5">
            <SwitchField
              id="subdivision-descendants"
              label="Считать вместе с вложенными подразделениями"
              hint={`Вложенных: ${data.subdivision.childrenCount}. Выключите, чтобы увидеть цифры только самого подразделения.`}
              checked={s.includeDescendants}
              onCheckedChange={(checked) => s.setIncludeDescendants(checked)}
            />
          </div>
        )}

        <KpiRow totals={data.totals} prev={data.prev.totals} busy={s.isLoading} />

        {childRows.length > 0 && (
          <>
            <Eyebrow count={childRows.length} action={<ClassLegend />}>
              Время по вложенным подразделениям
            </Eyebrow>
            <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
              <StackedTimeBars rows={childRows} />
              <AttributionNote diagnostics={data.diagnostics} />
            </div>

            <Eyebrow count={childRows.length}>Сводка по вложенным</Eyebrow>
            <div className="tw:overflow-x-auto tw:rounded-xl tw:border tw:border-border tw:bg-card tw:px-2 tw:py-1.5">
              <SubdivisionsTable
                subdivisions={data.children}
                unassigned={null}
                totals={data.totals}
                onOpen={(childId) =>
                  navigate(
                    `/report/companies/${data.company._id}/subdivisions/${childId}`,
                  )
                }
              />
            </div>
          </>
        )}

        <div className="tw:grid tw:gap-x-6 tw:lg:grid-cols-2">
          <CategorySection categories={data.byCategory} />
          <div>
            <Eyebrow count={data.byApplicant.length}>Кто обращался</Eyebrow>
            <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
              <ShareBars
                rows={data.byApplicant.map((applicant) => ({
                  key: applicant._id ?? "unknown",
                  label:
                    `${applicant.lastName} ${applicant.firstName}`.trim() ||
                    "Заявитель не указан",
                  value: applicant.ticketsCount,
                }))}
                // По оси не время, а число заявок
                unit="count"
              />
              <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-faint">
                Значение — сколько заявок закрыто за период (
                {data.totals.totalTickets} {declOfTickets(data.totals.totalTickets)}{" "}
                всего). Это заявители со стороны клиента, а не наши исполнители.
              </p>
            </div>
          </div>
        </div>

        <MonthsSection months={data.byMonth} />
      </div>
    );
  }

  return (
    <ReportShell
      title={data?.subdivision.name ?? "Подразделение"}
      subtitle={
        data && (
          <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2">
            {data.company.alias}
            {data.subdivision.manager && (
              <>
                <span className="tw:text-faint">·</span>
                руководитель {data.subdivision.manager.lastName}{" "}
                {data.subdivision.manager.firstName}
              </>
            )}
            {data.subdivision.usersCount > 0 && (
              <>
                <span className="tw:text-faint">·</span>
                {data.subdivision.usersCount} пользователей
              </>
            )}
          </span>
        )
      }
      icon={data && <CardMonogram name={data.subdivision.name} />}
      breadcrumb={
        <CardCrumbs
          items={[
            {
              label: "Компании",
              to: data?.scope.defaultView ? undefined : "/report/companies",
            },
            {
              label: data?.company.alias ?? "Компания",
              // Руководителю подразделения карточка компании недоступна —
              // ссылку не показываем, а не отдаём 403 по клику
              to:
                data && data.access === "full"
                  ? `/report/companies/${companyId}`
                  : undefined,
            },
            { label: data?.subdivision.name ?? "Подразделение" },
          ]}
        />
      }
      toolbar={toolbar}
    >
      <FilterSheet>
        <PeriodFilter
          idPrefix="subdivision-card"
          from={s.from}
          to={s.to}
          onChange={(patch) => s.setPeriod(patch)}
          onReset={() => s.resetPeriod()}
        />
      </FilterSheet>
      {body}
    </ReportShell>
  );
};

export default SubdivisionReport;

export function loader() {
  document.title = "Отчёт по подразделению";
  return null;
}
