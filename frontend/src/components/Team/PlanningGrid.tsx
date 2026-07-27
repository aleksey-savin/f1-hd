import { cn } from "@/lib/utils";
import type { TeamScheduleResponse } from "@/types/teamSchedule";
import { getAbsenceType } from "@/util/absence-types";

import {
  DOW_SHORT,
  dayNumber,
  dowOf,
  fullName,
  initialsOf,
  isThin,
  offsetLabel,
  statusColor,
} from "./calendar";

type Props = { data: TeamScheduleResponse };

/**
 * Планирование отпусков — единственный вид, где нужна ось сотрудников.
 *
 * Отсутствия идут непрерывными полосами, поэтому пересечения видно сразу, а
 * внизу строка «Доступно» подсвечивает дни, где команда просела. Запрос на
 * согласовании рисуется пунктиром: видно, во что он превратит месяц, ДО того
 * как его подтвердить.
 */
const PlanningGrid = ({ data }: Props) => {
  const dates = data.calendar.days;
  const calByDate = new Map(dates.map((day) => [day.date, day]));
  const availByDate = new Map(data.availability.map((day) => [day.date, day]));
  const total = data.employees.length;

  return (
    <div className="tw:overflow-x-auto">
      <table className="tw:w-max tw:min-w-full tw:border-separate tw:border-spacing-0 tw:text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="tw:sticky tw:left-0 tw:z-20 tw:w-56 tw:min-w-56 tw:border-r tw:border-b tw:border-border tw:bg-card tw:px-3.5 tw:py-2.5 tw:text-left tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase"
            >
              Сотрудник
            </th>
            {dates.map((day) => {
              const off = day.kind === "weekend" || day.kind === "holiday";
              return (
                <th
                  key={day.date}
                  scope="col"
                  title={day.title ?? undefined}
                  className={cn(
                    "tw:w-7 tw:min-w-7 tw:border-b tw:border-border tw:pt-2 tw:pb-1.5 tw:text-center tw:leading-tight",
                    off ? "tw:bg-muted" : "tw:bg-card",
                  )}
                >
                  <span
                    className={cn(
                      "tw:block tw:text-xs tw:font-semibold tw:tabular-nums",
                      off ? "tw:text-faint" : "tw:text-foreground",
                    )}
                  >
                    {dayNumber(day.date)}
                  </span>
                  <span className="tw:block tw:text-xs tw:text-faint">
                    {DOW_SHORT[dowOf(day.date)]}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {data.employees.map((member) => (
            <tr key={member.user._id}>
              <td className="tw:sticky tw:left-0 tw:z-10 tw:border-r tw:border-b tw:border-border-soft tw:bg-card tw:px-3.5 tw:py-1.5">
                <span className="tw:flex tw:items-center tw:gap-2.5">
                  <span
                    className="tw:grid tw:size-7 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-accent tw:text-xs tw:font-semibold tw:text-muted-foreground"
                    style={{
                      boxShadow: `0 0 0 2px var(--card), 0 0 0 3px ${statusColor(member.status?.code)}`,
                    }}
                  >
                    {initialsOf(member.user)}
                  </span>
                  <span className="tw:min-w-0">
                    <span className="tw:block tw:truncate tw:text-sm tw:font-medium tw:text-foreground">
                      {fullName(member.user)}
                    </span>
                    <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground tw:tabular-nums">
                      {member.city} {offsetLabel(member.utcOffsetMinutes)}
                    </span>
                  </span>
                </span>
              </td>

              {member.days.map((day) => {
                const meta = calByDate.get(day.date);
                const off = meta?.kind === "weekend" || meta?.kind === "holiday";
                const absence = day.absence;
                const color =
                  getAbsenceType(absence?.type ?? "")?.color ?? "var(--ws-st-unset)";
                const first = absence?.from === day.date;
                const last = absence?.to === day.date;
                const pending = absence?.status === "pending";

                return (
                  <td
                    key={day.date}
                    title={
                      absence
                        ? `${fullName(member.user)} · ${absence.label}${pending ? " (ждёт решения)" : ""}`
                        : `${fullName(member.user)} · ${dayNumber(day.date)}`
                    }
                    className={cn(
                      "tw:relative tw:h-9 tw:border-b tw:border-border-soft",
                      off && "tw:bg-muted",
                    )}
                  >
                    {absence ? (
                      <span
                        className={cn(
                          "tw:absolute tw:inset-y-2",
                          first ? "tw:left-0.5 tw:rounded-l-md" : "tw:left-0",
                          last ? "tw:right-0.5 tw:rounded-r-md" : "tw:right-0",
                        )}
                        style={
                          pending
                            ? {
                                border: `1.5px dashed ${color}`,
                                borderLeftWidth: first ? 1.5 : 0,
                                borderRightWidth: last ? 1.5 : 0,
                              }
                            : { background: color }
                        }
                      />
                    ) : (
                      !off && (
                        <span
                          className="tw:absolute tw:top-1/2 tw:left-1/2 tw:size-1 tw:-translate-x-1/2 tw:-translate-y-1/2 tw:rounded-full"
                          style={{
                            background:
                              "color-mix(in srgb, var(--foreground) 16%, transparent)",
                          }}
                        />
                      )
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <td className="tw:sticky tw:left-0 tw:z-10 tw:border-t tw:border-r tw:border-border tw:bg-card tw:px-3.5 tw:py-2.5 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
              Доступно
            </td>
            {dates.map((day) => {
              const avail = availByDate.get(day.date);
              const off = day.kind === "weekend" || day.kind === "holiday";
              const working = avail?.working ?? 0;
              const thin = !off && isThin(working, total);
              return (
                <td
                  key={day.date}
                  className={cn(
                    "tw:border-t tw:border-border tw:py-2 tw:text-center tw:text-xs tw:tabular-nums",
                    off && "tw:bg-muted",
                    thin
                      ? "tw:bg-warning/15 tw:font-bold tw:text-warning"
                      : "tw:text-muted-foreground",
                  )}
                >
                  {off ? "" : working}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

export default PlanningGrid;
