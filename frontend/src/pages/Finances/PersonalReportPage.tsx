import { useEffect, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { RiArrowLeftSLine, RiFilter3Line } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import MonthStepper from "@/components/app/MonthStepper";
import { Eyebrow, SubLabel } from "@/components/app/Panel";
import StatTile, { StatTileDelta } from "@/components/app/StatTile";
import InlineForbidden from "@/components/Error/InlineForbidden";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";

import ApprovalPanel from "../../components/Report/ApprovalPanel";
import ClassBar from "../../components/Report/ClassBar";
import EmptyReport from "../../components/Report/EmptyReport";
import FilterSheet from "../../components/Report/FilterSheet";
import PayslipPanel from "../../components/Report/PayslipPanel";
import PeriodFilter from "../../components/Report/PeriodFilter";
import PersonalWorksCards from "../../components/Report/PersonalWorksCards";
import PersonalWorksTable from "../../components/Report/PersonalWorksTable";
import ReportShell from "../../components/Report/ReportShell";
import ShareList from "../../components/Report/ShareList";
import WorkTimeBars from "../../components/Report/WorkTimeBars";
import { deltaOf } from "../../components/Report/delta";
import { formatMinutes, formatMoney } from "../../components/Report/work-format";
import { useAuthedUser } from "../../store/authed-user";
import usePersonalReportStore from "../../store/reports/personal-report";
import { isFullMonthRange } from "../../util/period";

// Персональный отчёт: «Мой отчёт» (own) и отчёт выбранного сотрудника
// (переход из сводной) — одна страница. Самодостаточен: сотруднику без права
// на аналитику здесь видна и статистика работы, и переработки, и расчёт.
const HINT = "к прошлому периоду";
const MONTH_SHORT = new Intl.DateTimeFormat("ru-RU", { month: "short" });

const Panel = ({ children }: { children: ReactNode }) => (
  <section className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-5">
    {children}
  </section>
);

const PersonalReportPage = ({ own = false }: { own?: boolean }) => {
  const { userId } = useParams();
  const s = usePersonalReportStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const authedUser = useAuthedUser();

  // Свой отчёт запрашиваем без userId — сервер возьмёт из токена
  const targetUserId = own || !userId ? null : userId;

  useEffect(() => {
    s.setUser(targetUserId);
    if (usePersonalReportStore.getState().data === null) {
      s.fetch();
    }
  }, [targetUserId]);

  const filterActive = !isFullMonthRange(s.from, s.to);
  const data = s.data;
  const isOwn = own || !userId || userId === authedUser?._id;
  // Сводная доступна только с полным правом — только им и показываем возврат
  const canSeeSummary = Boolean(
    authedUser?.isAdmin || authedUser?.permissions?.canSeeGlobalFinancialReport,
  );

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
  if (s.isForbidden) {
    body = (
      <InlineForbidden
        right="Просмотр общего финансового отчёта"
        action="смотреть отчёт другого сотрудника"
      />
    );
  } else if (!data) {
    body = s.error ? (
      errorBanner
    ) : (
      <div className="tw:space-y-6">
        <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:xl:grid-cols-5 tw:xl:gap-4">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="tw:h-28 tw:rounded-xl" />
          ))}
        </div>
        <div className="tw:grid tw:gap-5 tw:lg:grid-cols-2">
          <Skeleton className="tw:h-56 tw:rounded-xl" />
          <Skeleton className="tw:h-56 tw:rounded-xl" />
        </div>
      </div>
    );
  } else if (data.totals.worksCount === 0) {
    body = (
      <>
        {errorBanner}
        <EmptyReport
          title="Нет работ за период"
          hint={
            isOwn
              ? "За выбранный период у вас нет завершённых работ. Полистайте месяцы стрелками или задайте период в фильтре."
              : "За выбранный период у сотрудника нет завершённых работ."
          }
          action={
            <Button variant="outline" onClick={() => s.resetPeriod()}>
              Текущий месяц
            </Button>
          }
        />
      </>
    );
  } else {
    const { totals, prevPeriod } = data;
    const approvedCount = data.totals.byStatus.approved?.count ?? 0;

    const dayBars = data.byDay.map((day) => {
      const date = new Date(`${day.date}T00:00:00`);
      return {
        key: day.date,
        label: String(date.getDate()),
        minutes: day.minutes,
        overtimeMinutes: day.overtimeMinutes,
      };
    });

    const monthBars = data.byMonth.map((month) => {
      const date = new Date(`${month.month}-01T00:00:00`);
      return {
        key: month.month,
        label: MONTH_SHORT.format(date).replace(".", ""),
        minutes: month.minutes,
        overtimeMinutes: month.overtimeMinutes,
      };
    });

    const monthlyAverage =
      monthBars.reduce((sum, month) => sum + month.minutes, 0) /
      Math.max(monthBars.length, 1);
    const peak = [...data.byMonth].sort((a, b) => b.minutes - a.minutes)[0];

    body = (
      <div className={cn("tw:transition-opacity", s.isLoading && "tw:opacity-60")}>
        {errorBanner}

        <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:xl:grid-cols-5 tw:xl:gap-4">
          <StatTile
            label="Отработано"
            busy={s.isLoading}
            value={formatMinutes(totals.totalMinutes)}
            delta={
              <StatTileDelta
                {...deltaOf(totals.totalMinutes, prevPeriod.totals.totalMinutes)}
                hint={HINT}
              />
            }
            footer={
              totals.normMinutes > 0
                ? `норма периода ${formatMinutes(totals.normMinutes)} · ${totals.utilizationPercent}%`
                : undefined
            }
          />
          <StatTile
            label="Переработки"
            busy={s.isLoading}
            value={formatMinutes(totals.overtime.roundedMinutes)}
            delta={
              <StatTileDelta
                {...deltaOf(
                  totals.overtime.roundedMinutes,
                  prevPeriod.totals.overtime.roundedMinutes,
                )}
                hint={HINT}
              />
            }
            footer={`будни ${formatMinutes(totals.overtime.weekdayMinutes)} · выходные ${formatMinutes(totals.overtime.weekendMinutes)}`}
          />
          <StatTile
            label="К доплате"
            busy={s.isLoading}
            value={
              data.payroll.overtimePay == null ? (
                <span className="tw:text-warning">нет ставки</span>
              ) : (
                formatMoney(data.payroll.overtimePay)
              )
            }
            delta={
              <StatTileDelta
                {...deltaOf(
                  data.payroll.overtimePay ?? 0,
                  prevPeriod.overtimePay ?? 0,
                )}
                hint={HINT}
              />
            }
            footer={`${totals.overtime.daysWithOvertime} дней с переработкой`}
          />
          <StatTile
            label="Работы"
            busy={s.isLoading}
            value={totals.worksCount}
            delta={
              <StatTileDelta
                {...deltaOf(totals.worksCount, prevPeriod.totals.worksCount)}
                hint={HINT}
              />
            }
            footer={`${data.byDay.filter((day) => day.minutes > 0).length} дней с работами из ${data.byDay.length}`}
          />
          <StatTile
            label="Заявок закрыто"
            busy={s.isLoading}
            value={totals.ticketsFinished}
            delta={
              <StatTileDelta
                {...deltaOf(
                  totals.ticketsFinished,
                  prevPeriod.totals.ticketsFinished,
                )}
                hint={HINT}
              />
            }
            footer={`по ${totals.worksCount} работам`}
          />
        </div>

        {/* Финансовая часть — сразу под плитками: с ней приходят чаще, чем со
            статистикой */}
        <div className="tw:grid tw:gap-5 tw:lg:grid-cols-2">
          <div>
            <Eyebrow>Расчёт за месяц</Eyebrow>
            <Panel>
              <PayslipPanel payroll={data.payroll} />
            </Panel>
          </div>
          <div>
            <Eyebrow count={totals.worksCount}>Согласование работ</Eyebrow>
            <Panel>
              <ApprovalPanel
                byStatus={totals.byStatus}
                note="Утверждённые вошли в отчёт по услугам и в биллинге больше не меняются. Превью ещё не отправлены на согласование — их время и переработки могут уточниться."
              />
            </Panel>
          </div>
        </div>

        <Eyebrow>Структура работ</Eyebrow>
        <Panel>
          <ClassBar classes={totals} />
          <div className="tw:mt-5 tw:grid tw:gap-6 tw:border-t tw:border-border-soft tw:pt-4.5 tw:lg:grid-cols-2">
            <div>
              <SubLabel count={data.byCompany.length}>По компаниям</SubLabel>
              <ShareList
                rows={data.byCompany.map((company) => ({
                  key: company._id ?? "none",
                  label: company.alias,
                  minutes: company.minutes,
                }))}
              />
            </div>
            <div>
              <SubLabel count={data.byCategory.length}>
                По категориям заявок
              </SubLabel>
              <ShareList
                rows={data.byCategory.map((category) => ({
                  key: category._id ?? "none",
                  label: category.title,
                  minutes: category.minutes,
                }))}
              />
            </div>
          </div>
        </Panel>

        <div className="tw:grid tw:gap-5 tw:lg:grid-cols-2">
          <div>
            <Eyebrow>Время по дням</Eyebrow>
            <Panel>
              <WorkTimeBars bars={dayBars} tickEvery={dayBars.length > 20 ? 6 : 2} />
              <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-faint tw:tabular-nums">
                {data.byDay.filter((day) => day.minutes > 0).length} дней с
                работами · переработка показана янтарной частью столбика
              </p>
            </Panel>
          </div>
          <div>
            <Eyebrow>Динамика за 12 месяцев</Eyebrow>
            <Panel>
              <WorkTimeBars bars={monthBars} />
              <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-faint tw:tabular-nums">
                в среднем {formatMinutes(monthlyAverage)} в месяц
                {peak && peak.minutes > 0
                  ? ` · максимум ${formatMinutes(peak.minutes)}`
                  : ""}
              </p>
            </Panel>
          </div>
        </div>

        <Eyebrow count={data.works.length}>Работы за период</Eyebrow>
        <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card">
          <div className="tw:hidden tw:overflow-x-auto tw:px-2 tw:py-1.5 tw:md:block">
            <PersonalWorksTable
              works={data.works}
              totalMinutes={totals.totalMinutes}
              overtimeMinutes={totals.overtime.roundedMinutes}
              approvedCount={approvedCount}
            />
          </div>
          <div className="tw:md:hidden">
            <PersonalWorksCards works={data.works} />
          </div>
        </div>
      </div>
    );
  }

  const subtitle =
    data && !isOwn
      ? [
          data.employee.position || null,
          data.payroll.overtimeHourlyRate
            ? `ставка переработок ${data.payroll.overtimeHourlyRate.toLocaleString("ru-RU")} ₽/ч`
            : "ставка переработок не задана",
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  return (
    <ReportShell
      title={
        isOwn
          ? "Мой отчёт"
          : data
            ? `${data.employee.lastName} ${data.employee.firstName}`
            : "Отчёт сотрудника"
      }
      subtitle={subtitle}
      breadcrumb={
        canSeeSummary ? (
          <Link
            to="/finances/employees"
            className="tw:inline-flex tw:items-center tw:gap-0.5 tw:text-sm tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
          >
            <RiArrowLeftSLine size={16} aria-hidden />
            Сотрудники
          </Link>
        ) : undefined
      }
      toolbar={toolbar}
    >
      <FilterSheet>
        <PeriodFilter
          idPrefix="personal"
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

export default PersonalReportPage;

export function loader() {
  document.title = "Отчёт сотрудника";
  return null;
}

export function ownLoader() {
  document.title = "Мой отчёт";
  return null;
}
