import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { RiFilter3Line } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import MonthStepper from "@/components/app/MonthStepper";
import { Eyebrow } from "@/components/app/Panel";
import StatTile, { StatTileDelta } from "@/components/app/StatTile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";
import { cn } from "@/lib/utils";

import ApprovalPanel from "../../components/Report/ApprovalPanel";
import EmployeesCards from "../../components/Report/EmployeesCards";
import EmployeesTable from "../../components/Report/EmployeesTable";
import EmptyReport from "../../components/Report/EmptyReport";
import FilterSheet from "../../components/Report/FilterSheet";
import PeriodFilter from "../../components/Report/PeriodFilter";
import ReportShell from "../../components/Report/ReportShell";
import { deltaOf } from "../../components/Report/delta";
import {
  formatMinutes,
  formatMoney,
} from "../../components/Report/work-format";
import { useAuthedUser } from "../../store/authed-user";
import useEmployeesSummaryStore from "../../store/reports/employees-summary";
import { isFullMonthRange } from "../../util/period";

// «Сотрудники» — сводка по всем: часы, классы работ, переработки и доплата.
// Заменила отчёт «По сотрудникам» с захардкоженным графиком и ставкой: всё
// считает общий workOvertime, тот же, что и в персональном отчёте.
// Строка ведёт в отчёт сотрудника; своя строка помечена «Вы».
const HINT = "к прошлому периоду";

const Panel = ({ children }: { children: ReactNode }) => (
  <section className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
    {children}
  </section>
);

const EmployeesReport = () => {
  const s = useEmployeesSummaryStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const authedUser = useAuthedUser();

  useEffect(() => {
    s.fetch();
  }, []);

  const filterActive = !isFullMonthRange(s.from, s.to);
  const data = s.data;

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

  const errorBanner = s.error && (
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
  );

  let body: ReactNode;
  if (!data) {
    body = s.error ? (
      errorBanner
    ) : (
      <div className="tw:space-y-6">
        <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:xl:grid-cols-4 tw:xl:gap-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="tw:h-28 tw:rounded-xl" />
          ))}
        </div>
        <Skeleton className="tw:h-80 tw:rounded-xl" />
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
    const { totals, prev } = data;
    const missing = data.employees.filter(
      (row) => row.payroll.missingRate && row.overtime.roundedMinutes > 0,
    );
    const missingMinutes = missing.reduce(
      (sum, row) => sum + row.overtime.roundedMinutes,
      0,
    );

    body = (
      <div className={cn("tw:transition-opacity", s.isLoading && "tw:opacity-60")}>
        {errorBanner}

        <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:xl:grid-cols-4 tw:xl:gap-4">
          <StatTile
            label="Отработано"
            busy={s.isLoading}
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
            label="Переработки"
            busy={s.isLoading}
            value={formatMinutes(totals.overtime.roundedMinutes)}
            delta={
              <StatTileDelta
                {...deltaOf(
                  totals.overtime.roundedMinutes,
                  prev.totals.overtime.roundedMinutes,
                )}
                hint={HINT}
              />
            }
            footer={`Будни ${formatMinutes(totals.overtime.weekdayMinutes)} · Выходные ${formatMinutes(totals.overtime.weekendMinutes)}`}
          />
          <StatTile
            label="К доплате"
            busy={s.isLoading}
            value={formatMoney(totals.overtimePaySum)}
            delta={
              <StatTileDelta
                {...deltaOf(totals.overtimePaySum, prev.totals.overtimePaySum)}
                hint={HINT}
              />
            }
            footer={`по ставкам сотрудников ×${data.settings.weekdayCoefficient} будни / ×${data.settings.weekendCoefficient} выходные`}
          />
          <StatTile
            label="Заявок закрыто"
            busy={s.isLoading}
            value={totals.ticketsFinished}
            delta={
              <StatTileDelta
                {...deltaOf(totals.ticketsFinished, prev.totals.ticketsFinished)}
                hint={HINT}
              />
            }
            footer={`по ${totals.worksCount} работам · ${totals.onSite.count} выездов`}
          />
        </div>

        <Eyebrow
          count={totals.employeesCount}
          action={
            <span className="tw:text-sm tw:font-normal tw:text-faint">
              строка ведёт в отчёт сотрудника
            </span>
          }
        >
          Сводка за период
        </Eyebrow>

        {missing.length > 0 && (
          <AlertMessage
            variant="warning"
            className="tw:mt-0"
            message={
              <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1">
                <span>
                  <b className="tw:font-semibold">
                    {missing.length === 1
                      ? "У сотрудника не задана ставка переработок"
                      : `У ${missing.length} сотрудников не задана ставка переработок`}
                  </b>
                  <br />
                  <span className="tw:text-muted-foreground tw:tabular-nums">
                    {missing
                      .map(
                        (row) =>
                          `${row.employee.lastName} ${row.employee.firstName} (${formatMinutes(row.overtime.roundedMinutes)})`,
                      )
                      .join(", ")}{" "}
                    — {formatMinutes(missingMinutes)} переработок не попали в
                    доплату. Ставка задаётся в карточке сотрудника.
                  </span>
                </span>
                <Button asChild variant="outline" size="xs" className="tw:ms-auto">
                  <Link to="/users">Открыть пользователей</Link>
                </Button>
              </span>
            }
          />
        )}

        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card">
          <div className="tw:hidden tw:overflow-x-auto tw:px-2 tw:py-1.5 tw:md:block">
            <EmployeesTable
              employees={data.employees}
              totals={totals}
              currentUserId={authedUser?._id}
            />
          </div>
          <div className="tw:md:hidden">
            <EmployeesCards
              employees={data.employees}
              currentUserId={authedUser?._id}
            />
          </div>
        </div>

        <Eyebrow>Согласование работ</Eyebrow>
        <Panel>
          <div className="tw:grid tw:gap-6 tw:lg:grid-cols-2">
            <div>
              <ApprovalPanel
                byStatus={data.byStatus}
                note="Утверждённые работы вошли в отчёт по услугам — согласованы с клиентом и в биллинге больше не меняются."
              />
            </div>
            <label
              htmlFor="employees-approved-only"
              className="tw:flex tw:h-fit tw:cursor-pointer tw:items-start tw:gap-3 tw:rounded-lg tw:border tw:border-border-soft tw:p-4"
            >
              <Switch
                id="employees-approved-only"
                checked={s.approvedOnly}
                onCheckedChange={(checked) => s.setApprovedOnly(checked)}
              />
              <span className="tw:text-sm">
                <span className="tw:font-medium">Только согласованные работы</span>
                <span className="tw:mt-1 tw:block tw:text-xs tw:text-faint">
                  Учитывать лишь работы из утверждённых отчётов по услугам.
                  Влияет на весь отчёт — и на плитки, и на таблицу.
                </span>
              </span>
            </label>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <ReportShell title="Сотрудники" toolbar={toolbar}>
      <FilterSheet>
        <PeriodFilter
          idPrefix="employees"
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

export default EmployeesReport;

export function loader() {
  document.title = "Сотрудники";
  return null;
}
