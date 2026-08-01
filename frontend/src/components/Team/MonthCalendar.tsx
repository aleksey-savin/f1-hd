import { cn } from "@/lib/utils";
import type { TeamScheduleResponse } from "@/types/teamSchedule";

import { DOW_SHORT, dayNumber, dotState, dowOf, isThin } from "./calendar";

type Props = {
  data: TeamScheduleResponse;
  onSelectDay: (dateKey: string) => void;
};

/**
 * Месяц — «что происходит в этот день».
 *
 * В ячейке по точке на каждого сотрудника, и позиция точки ФИКСИРОВАНА:
 * третья точка — всегда один и тот же человек. По горизонтали читается день,
 * по вертикали — «этот в отпуске всю неделю». Счётчик появляется, только
 * когда кого-то нет: в обычный день он ничего не сообщает.
 */
const MonthCalendar = ({ data, onSelectDay }: Props) => {
  const dates = data.calendar.days;
  const calByDate = new Map(dates.map((day) => [day.date, day]));
  const availByDate = new Map(data.availability.map((day) => [day.date, day]));
  const leading = dowOf(dates[0]?.date ?? data.period.from);
  const total = data.employees.length;

  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border-soft">
      {DOW_SHORT.map((label) => (
        <div
          key={label}
          className="bg-card px-2.5 py-2 text-center text-xs font-bold tracking-wider text-faint uppercase"
        >
          {label}
        </div>
      ))}

      {Array.from({ length: leading }, (_, index) => (
        <div key={`blank-${index}`} className="bg-muted/50" />
      ))}

      {dates.map((calDay) => {
        const dateKey = calDay.date;
        const meta = calByDate.get(dateKey);
        const avail = availByDate.get(dateKey);
        const holiday = meta?.kind === "holiday";
        const off = holiday || meta?.kind === "weekend";
        const isToday = dateKey === data.period.today;
        const absent = avail ? avail.absent : 0;
        const working = avail ? avail.working : 0;

        return (
          <button
            key={dateKey}
            type="button"
            onClick={() => onSelectDay(dateKey)}
            className={cn(
              "flex min-h-26 appearance-none flex-col gap-1.5 border-0 px-2.5 py-2 text-left",
              off ? "bg-muted" : "bg-card",
              "hover:bg-accent",
              isToday && "inset-ring-2 inset-ring-primary",
            )}
          >
            <span className="flex w-full items-baseline gap-1.5">
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  off ? "text-faint" : "text-foreground",
                )}
              >
                {dayNumber(dateKey)}
              </span>
              {meta?.title && (
                <span
                  className={cn(
                    "truncate text-xs",
                    holiday ? "text-destructive" : "text-warning",
                  )}
                >
                  {meta.title}
                </span>
              )}
              {isToday && (
                <span className="ms-auto text-xs font-bold tracking-wide text-primary uppercase">
                  сегодня
                </span>
              )}
            </span>

            <span className="flex flex-wrap gap-1">
              {data.employees.map((member) => {
                const day = member.days.find((item) => item.date === dateKey);
                if (!day) return null;
                const dot = dotState(member, day, isToday);
                return (
                  <span
                    key={member.user._id}
                    title={dot.title}
                    className={cn(
                      "block size-2.5 rounded-full",
                      dot.hollow && "border border-dashed",
                    )}
                    style={
                      dot.hollow
                        ? { borderColor: dot.color }
                        : { background: dot.color }
                    }
                  />
                );
              })}
            </span>

            {!off && absent > 0 && (
              <span
                className={cn(
                  "mt-auto text-xs tabular-nums",
                  isThin(working, total)
                    ? "font-semibold text-warning"
                    : "text-muted-foreground",
                )}
              >
                работают {working} из {total}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default MonthCalendar;
