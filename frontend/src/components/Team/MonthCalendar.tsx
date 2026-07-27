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
    <div className="tw:grid tw:grid-cols-7 tw:gap-px tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-border-soft">
      {DOW_SHORT.map((label) => (
        <div
          key={label}
          className="tw:bg-card tw:px-2.5 tw:py-2 tw:text-center tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase"
        >
          {label}
        </div>
      ))}

      {Array.from({ length: leading }, (_, index) => (
        <div key={`blank-${index}`} className="tw:bg-muted/50" />
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
              "tw:flex tw:min-h-26 tw:appearance-none tw:flex-col tw:gap-1.5 tw:border-0 tw:px-2.5 tw:py-2 tw:text-left",
              off ? "tw:bg-muted" : "tw:bg-card",
              "tw:hover:bg-accent",
              isToday && "tw:inset-ring-2 tw:inset-ring-primary",
            )}
          >
            <span className="tw:flex tw:w-full tw:items-baseline tw:gap-1.5">
              <span
                className={cn(
                  "tw:text-sm tw:font-semibold tw:tabular-nums",
                  off ? "tw:text-faint" : "tw:text-foreground",
                )}
              >
                {dayNumber(dateKey)}
              </span>
              {meta?.title && (
                <span
                  className={cn(
                    "tw:truncate tw:text-xs",
                    holiday ? "tw:text-destructive" : "tw:text-warning",
                  )}
                >
                  {meta.title}
                </span>
              )}
              {isToday && (
                <span className="tw:ms-auto tw:text-xs tw:font-bold tw:tracking-wide tw:text-primary tw:uppercase">
                  сегодня
                </span>
              )}
            </span>

            <span className="tw:flex tw:flex-wrap tw:gap-1">
              {data.employees.map((member) => {
                const day = member.days.find((item) => item.date === dateKey);
                if (!day) return null;
                const dot = dotState(member, day, isToday);
                return (
                  <span
                    key={member.user._id}
                    title={dot.title}
                    className={cn(
                      "tw:block tw:size-2.5 tw:rounded-full",
                      dot.hollow && "tw:border tw:border-dashed",
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
                  "tw:mt-auto tw:text-xs tw:tabular-nums",
                  isThin(working, total)
                    ? "tw:font-semibold tw:text-warning"
                    : "tw:text-muted-foreground",
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
