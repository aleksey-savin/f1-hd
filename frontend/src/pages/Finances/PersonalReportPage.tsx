import { useEffect, type ReactNode } from "react";
import { useParams } from "react-router";
import { RiFilter3Line } from "react-icons/ri";

import Crumbs from "@/components/app/Crumbs";
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
import PageShell from "@/components/app/PageShell";
import ShareBars from "../../components/Report/ShareBars";
import WorkTimeBars from "../../components/Report/WorkTimeBars";
import { deltaOf } from "../../components/Report/delta";
import {
  formatMinutes,
  formatMoney,
} from "../../components/Report/work-format";
import { useAuthedUser, useCan } from "../../store/authed-user";
import usePersonalReportStore from "../../store/reports/personal-report";
import { isFullMonthRange } from "../../util/period";

// Персональный отчёт: «Мой отчёт» (own) и отчёт выбранного сотрудника
// (переход из сводной) — одна страница. Самодостаточен: сотруднику без права
// на аналитику здесь видна и статистика работы, и переработки, и расчёт.
//
// Свои деньги видит каждый; чужие — только с правом `user.manageFinances`. Без
// него в чужом отчёте нет ни плитки «К доплате», ни расчёта, ни ставки в
// подзаголовке: сервер этих полей и не присылает.
const HINT = "к прошлому периоду";
const MONTH_SHORT = new Intl.DateTimeFormat("ru-RU", { month: "short" });

const Panel = ({ children }: { children: ReactNode }) => (
  <section className="rounded-xl border border-border bg-card p-5">
    {children}
  </section>
);

const PersonalReportPage = ({ own = false }: { own?: boolean }) => {
  const { userId } = useParams();
  const s = usePersonalReportStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const authedUser = useAuthedUser();
  const can = useCan();

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
  // Чей отчёт — говорит САМ ОТВЕТ (`employee.isSelf`): `authedUser` на первом
  // рендере ещё не налит, и выражение ниже давало бы «чужой» на свои же деньги
  const isOwn = data
    ? data.employee.isSelf
    : own || !userId || userId === authedUser?._id;
  // Оклад, ставка и доплата: свои — всегда, чужие — по праву на оклады
  const canSeeMoney = isOwn || Boolean(can({ user: ["manageFinances"] }));
  // Сводная доступна только с полным правом — только им и показываем возврат
  const canSeeSummary = Boolean(can({ report: ["employees"] }));

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
  if (s.isForbidden) {
    body = isOwn ? (
      <InlineForbidden right="report.own" action="смотреть свой отчёт" />
    ) : (
      <InlineForbidden
        right="report.employees"
        action="смотреть отчёт другого сотрудника"
      />
    );
  } else if (!data) {
    body = s.error ? (
      errorBanner
    ) : (
      <div className="space-y-6">
        <div
          className={cn(
            "grid grid-cols-2 gap-3 xl:gap-4",
            canSeeMoney ? "xl:grid-cols-5" : "xl:grid-cols-4",
          )}
        >
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
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
      <div className={cn("transition-opacity", s.isLoading && "opacity-60")}>
        {errorBanner}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5 xl:gap-4">
          <StatTile
            label="Отработано"
            busy={s.isLoading}
            value={formatMinutes(totals.totalMinutes)}
            delta={
              <StatTileDelta
                {...deltaOf(
                  totals.totalMinutes,
                  prevPeriod.totals.totalMinutes,
                )}
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
          {canSeeMoney && (
            <StatTile
              label="К доплате"
              busy={s.isLoading}
              value={
                data.payroll.overtimePay == null ? (
                  <span className="text-warning">нет ставки</span>
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
          )}
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
            статистикой. Без права на деньги расчёта нет, и согласование
            занимает всю ширину, а не половину рядом с пустотой */}
        <div className={cn("grid gap-5", canSeeMoney && "lg:grid-cols-2")}>
          {canSeeMoney && (
            <div>
              <Eyebrow>Расчёт за месяц</Eyebrow>
              <Panel>
                <PayslipPanel payroll={data.payroll} />
              </Panel>
            </div>
          )}
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
          <div className="mt-5 grid gap-6 border-t border-border-soft pt-4.5 lg:grid-cols-2">
            <div>
              <SubLabel count={data.byCompany.length}>По компаниям</SubLabel>
              <ShareBars
                rows={data.byCompany.map((company) => ({
                  key: company._id ?? "none",
                  label: company.alias,
                  value: company.minutes,
                }))}
              />
            </div>
            <div>
              <SubLabel count={data.byCategory.length}>
                По категориям заявок
              </SubLabel>
              <ShareBars
                rows={data.byCategory.map((category) => ({
                  key: category._id ?? "none",
                  label: category.title,
                  value: category.minutes,
                }))}
              />
            </div>
          </div>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <Eyebrow>Время по дням</Eyebrow>
            <Panel>
              <WorkTimeBars
                bars={dayBars}
                tickEvery={dayBars.length > 20 ? 6 : 2}
              />
              <p className="mt-3 mb-0 text-xs text-faint tabular-nums">
                {data.byDay.filter((day) => day.minutes > 0).length} дней с
                работами · переработка показана янтарной частью столбика
              </p>
            </Panel>
          </div>
          <div>
            <Eyebrow>Динамика за 12 месяцев</Eyebrow>
            <Panel>
              <WorkTimeBars bars={monthBars} />
              <p className="mt-3 mb-0 text-xs text-faint tabular-nums">
                в среднем {formatMinutes(monthlyAverage)} в месяц
                {peak && peak.minutes > 0
                  ? ` · максимум ${formatMinutes(peak.minutes)}`
                  : ""}
              </p>
            </Panel>
          </div>
        </div>

        <Eyebrow count={data.works.length}>Работы за период</Eyebrow>
        <div className="rounded-xl border border-border bg-card">
          <div className="hidden overflow-x-auto px-2 py-1.5 md:block">
            <PersonalWorksTable
              works={data.works}
              totalMinutes={totals.totalMinutes}
              overtimeMinutes={totals.overtime.roundedMinutes}
              approvedCount={approvedCount}
            />
          </div>
          <div className="md:hidden">
            <PersonalWorksCards works={data.works} />
          </div>
        </div>
      </div>
    );
  }

  const subtitleParts =
    data && !isOwn
      ? [
          data.employee.position || null,
          // Ставка в подзаголовке — тоже деньги: без права её здесь нет
          canSeeMoney
            ? data.payroll.overtimeHourlyRate
              ? `ставка переработок ${data.payroll.overtimeHourlyRate.toLocaleString("ru-RU")} ₽/ч`
              : "ставка переработок не задана"
            : null,
        ].filter(Boolean)
      : [];
  const subtitle = subtitleParts.length ? subtitleParts.join(" · ") : undefined;

  return (
    <PageShell
      title={
        isOwn
          ? "Мой отчёт"
          : data
            ? `${data.employee.lastName} ${data.employee.firstName}`
            : "Отчёт сотрудника"
      }
      subtitle={subtitle}
      breadcrumb={
        <Crumbs
          // Свой отчёт открывают из меню, сводной над ним нет — без источника
          // крошка молчит, вместо ссылки в чужой раздел
          section={canSeeSummary ? "employees-report" : false}
        />
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
    </PageShell>
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
