import { useEffect, useMemo, useState } from "react";
import { RiAddFill, RiFilter3Line } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import MonthStepper from "@/components/app/MonthStepper";
import { Eyebrow } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import AbsenceForm from "@/components/Team/AbsenceForm";
import DayPopover from "@/components/Team/DayPopover";
import Legend from "@/components/Team/Legend";
import MonthCalendar from "@/components/Team/MonthCalendar";
import PendingAlert from "@/components/Team/PendingAlert";
import PlanningGrid from "@/components/Team/PlanningGrid";
import ScheduleFilter from "@/components/Team/ScheduleFilter";
import TodayView from "@/components/Team/TodayView";
import { isThin } from "@/components/Team/calendar";
import FilterSheet from "@/components/Report/FilterSheet";
import PageShell from "@/components/app/PageShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";
import useTeamScheduleStore, { type ScheduleView } from "@/store/team/schedule";

const API = import.meta.env.VITE_API_ADDRESS;

const VIEWS = [
  { value: "month", label: "Месяц" },
  { value: "today", label: "Сегодня" },
  { value: "planning", label: "Планирование" },
];

const humanDay = (dateKey: string) => Number(dateKey.slice(8, 10));

/**
 * Календарь команды — кто доступен.
 *
 * Часов, нормы и переработок здесь нет намеренно: два часа работ за день
 * ничего не говорят о человеке и мешают увидеть главное. Выработка живёт
 * в отчёте «Сотрудники».
 */
const TeamCalendar = () => {
  const store = useTeamScheduleStore();
  const filterOffcanvas = useMobileFilterOffcanvasStore();
  const data = store.data;
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [dayKey, setDayKey] = useState<string | null>(null);

  useEffect(() => {
    store.fetch();
  }, []);

  const decide = async (
    id: string,
    decision: "approve" | "reject",
    comment?: string,
  ) => {
    const response = await fetch(`${API}/api/team/absences/${id}/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ decision, comment }),
    });
    if (!response.ok) {
      console.warn("Решение по отсутствию не сохранилось", response.status);
      return;
    }
    store.fetch();
  };

  /**
   * Во что подтверждение превратит команду. Решение принимается с цифрой
   * перед глазами, а не вслепую: считаем минимум доступности по дням запроса,
   * вычитая заявителя из тех дней, где он сейчас работает.
   */
  const impactOf = useMemo(() => {
    if (!data) return () => null;
    const availByDate = new Map(
      data.availability.map((day) => [day.date, day]),
    );
    return (requestId: string) => {
      const request = data.pending.find((item) => item._id === requestId);
      if (!request || !request.away) return null;
      const member = data.employees.find(
        (item) => item.user._id === request.user._id,
      );
      if (!member) return null;
      let min: number | null = null;
      for (const day of member.days) {
        if (day.date < request.from || day.date > request.to) continue;
        if (day.offDuty || day.away) continue;
        const working = (availByDate.get(day.date)?.working ?? 1) - 1;
        if (min === null || working < min) min = working;
      }
      return min;
    };
  }, [data]);

  const filterActive = Boolean(store.search || store.company);

  const dips = useMemo(() => {
    if (!data) return [];
    const total = data.employees.length;
    return data.availability.filter(
      (day) => day.absent > 0 && isThin(day.working, total),
    );
  }, [data]);

  const toolbar = (
    <>
      <Segmented
        ariaLabel="Вид календаря"
        options={VIEWS}
        value={store.view}
        onChange={(value) => store.setView(value as ScheduleView)}
      />
      {store.view !== "today" && (
        <MonthStepper
          from={store.from}
          to={store.to}
          onChange={(range) => store.setPeriod(range)}
          allowFuture
        />
      )}
      <Button
        variant={filterActive ? "success" : "outline"}
        size="icon"
        title="Фильтр"
        aria-label="Фильтр"
        onClick={() => filterOffcanvas.handleShow()}
      >
        <RiFilter3Line />
      </Button>
    </>
  );

  // Главное действие страницы — в углу шапки на любой ширине, не в тулбаре
  const absenceAction = (
    <Button onClick={() => setAbsenceOpen(true)}>
      <RiAddFill />
      <span className="max-sm:hidden">Отсутствие</span>
    </Button>
  );

  let body;
  if (!data) {
    body = store.error ? (
      <AlertMessage
        variant="danger"
        message={
          <span className="flex flex-wrap items-center gap-3">
            {store.error}
            <Button variant="outline" size="sm" onClick={() => store.fetch()}>
              Повторить
            </Button>
          </span>
        }
      />
    ) : (
      <div className="space-y-4">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  } else {
    body = (
      <div
        className={cn("transition-opacity", store.isLoading && "opacity-60")}
      >
        {store.error && (
          <AlertMessage
            variant="danger"
            message={
              <span className="flex flex-wrap items-center gap-3">
                {store.error}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => store.fetch()}
                >
                  Повторить
                </Button>
              </span>
            }
          />
        )}

        {dips.length > 0 && store.view !== "today" && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border border-warning/45 bg-warning/10 px-4 py-3 text-sm">
            <span className="text-warning">⚠</span>
            <span className="min-w-0 flex-1">
              <b className="font-semibold">
                {dips.length === 1
                  ? `${humanDay(dips[0].date)} числа работают ${dips[0].working} из ${data.employees.length}`
                  : `${humanDay(dips[0].date)}–${humanDay(dips[dips.length - 1].date)} числа работают ${Math.min(...dips.map((d) => d.working))} из ${data.employees.length}`}
              </b>
              <span className="text-muted-foreground">
                {" "}
                · отсутствия накладываются
              </span>
            </span>
            {store.view !== "planning" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => store.setView("planning")}
              >
                Показать в планировании
              </Button>
            )}
          </div>
        )}

        {(data.calendar.missingYears?.length ?? 0) > 0 && (
          <div className="mb-5">
            <AlertMessage
              variant="warning"
              message={`Производственный календарь на ${data.calendar.missingYears.join(" и ")} год не издан: праздники и переносы не учтены, нерабочими показаны только суббота и воскресенье. Планировать отпуска на этот период можно, но норму дней он покажет неточно.`}
            />
          </div>
        )}

        {data.pending.length > 0 && (
          <div className="mb-5">
            <PendingAlert
              pending={data.pending}
              canManage={data.canManage}
              onDecide={decide}
              impactOf={impactOf}
              total={data.employees.length}
            />
          </div>
        )}

        {data.employees.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-5 py-12 text-center">
            <p className="mx-auto mb-3 max-w-md text-sm text-muted-foreground">
              Под выбранные условия не попал ни один сотрудник. Измените период
              или сбросьте фильтры.
            </p>
            <Button variant="outline" onClick={() => store.resetFilter()}>
              Сбросить фильтры
            </Button>
          </div>
        ) : store.view === "today" ? (
          <TodayView data={data} />
        ) : store.view === "planning" ? (
          <>
            <Eyebrow count={data.employees.length}>
              Планирование отсутствий
            </Eyebrow>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <PlanningGrid data={data} />
            </div>
          </>
        ) : (
          <>
            <MonthCalendar data={data} onSelectDay={setDayKey} />
            <Legend />
          </>
        )}
      </div>
    );
  }

  const subtitle = data ? (
    <>
      {data.period.todayInPeriod && data.totals.workingToday !== null ? (
        <>
          сегодня работают {data.totals.workingToday} из{" "}
          {data.totals.employeesCount}
          <span className="px-1.5 text-faint">·</span>к клиенту могут выехать{" "}
          {data.totals.canVisitToday}
        </>
      ) : (
        <>{data.totals.employeesCount} сотрудников</>
      )}
      {data.totals.noScheduleCount > 0 && (
        <>
          <span className="px-1.5 text-faint">·</span>
          <span className="text-warning">
            без графика: {data.totals.noScheduleCount}
          </span>
        </>
      )}
    </>
  ) : undefined;

  return (
    <PageShell
      title="Календарь команды"
      subtitle={subtitle}
      toolbar={toolbar}
      action={absenceAction}
    >
      <FilterSheet>
        <ScheduleFilter />
      </FilterSheet>

      {/* Применённый фильтр всегда виден: снимаемые бейджи над содержимым */}
      {filterActive && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {store.search && (
            <button
              type="button"
              onClick={() => store.setFilter({ search: "" })}
              className="inline-flex appearance-none items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground"
            >
              Сотрудник: {store.search} <span className="text-faint">✕</span>
            </button>
          )}
          {store.company && (
            <button
              type="button"
              onClick={() => store.setFilter({ company: null })}
              className="inline-flex appearance-none items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground"
            >
              Компания выбрана <span className="text-faint">✕</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => store.resetFilter()}
            className="appearance-none border-0 bg-transparent text-xs text-muted-foreground underline"
          >
            Сбросить
          </button>
        </div>
      )}

      {body}
      {data && (
        <DayPopover
          data={data}
          dateKey={dayKey}
          onClose={() => setDayKey(null)}
          onAddAbsence={() => {
            setDayKey(null);
            setAbsenceOpen(true);
          }}
        />
      )}
      <AbsenceForm
        open={absenceOpen}
        onOpenChange={setAbsenceOpen}
        canManage={Boolean(data?.canManage)}
        employees={data?.employees ?? []}
        onSaved={() => store.fetch()}
      />
    </PageShell>
  );
};

export default TeamCalendar;

export function loader() {
  document.title = "Календарь команды";
  return null;
}
