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
    <div className="overflow-x-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 w-56 min-w-56 border-r border-b border-border bg-card px-3.5 py-2.5 text-left text-xs font-bold tracking-wider text-faint uppercase"
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
                    "w-7 min-w-7 border-b border-border pt-2 pb-1.5 text-center leading-tight",
                    off ? "bg-muted" : "bg-card",
                  )}
                >
                  <span
                    className={cn(
                      "block text-xs font-semibold tabular-nums",
                      off ? "text-faint" : "text-foreground",
                    )}
                  >
                    {dayNumber(day.date)}
                  </span>
                  <span className="block text-xs text-faint">
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
              <td className="sticky left-0 z-10 border-r border-b border-border-soft bg-card px-3.5 py-1.5">
                <span className="flex items-center gap-2.5">
                  <span
                    className="grid size-7 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-muted-foreground"
                    style={{
                      boxShadow: `0 0 0 2px var(--card), 0 0 0 3px ${statusColor(member.status?.code)}`,
                    }}
                  >
                    {initialsOf(member.user)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {fullName(member.user)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground tabular-nums">
                      {member.city} {offsetLabel(member.utcOffsetMinutes)}
                    </span>
                  </span>
                </span>
              </td>

              {member.days.map((day) => {
                const meta = calByDate.get(day.date);
                const off =
                  meta?.kind === "weekend" || meta?.kind === "holiday";
                const absence = day.absence;
                const color =
                  getAbsenceType(absence?.type ?? "")?.color ??
                  "var(--ws-st-unset)";
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
                      "relative h-9 border-b border-border-soft",
                      off && "bg-muted",
                    )}
                  >
                    {absence ? (
                      <span
                        className={cn(
                          "absolute inset-y-2",
                          first ? "left-0.5 rounded-l-md" : "left-0",
                          last ? "right-0.5 rounded-r-md" : "right-0",
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
                          className="absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
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
            <td className="sticky left-0 z-10 border-t border-r border-border bg-card px-3.5 py-2.5 text-xs font-bold tracking-wider text-faint uppercase">
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
                    "border-t border-border py-2 text-center text-xs tabular-nums",
                    off && "bg-muted",
                    thin
                      ? "bg-warning/15 font-bold text-warning"
                      : "text-muted-foreground",
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
