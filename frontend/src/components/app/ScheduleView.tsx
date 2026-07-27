import { cn } from "@/lib/utils";

import { SCHEDULE_DAYS } from "./ScheduleEditor";

type Day = {
  isWorking?: boolean;
  is24hours?: boolean;
  start?: string;
  end?: string;
  breakMinutes?: number;
};

/**
 * Read-показ недельного графика — парный двойник app/ScheduleEditor.
 * Одна информация — один вид: до него эта сетка была свёрстана заново в
 * карточке компании, карточке услуги и сводке формы компании.
 *
 * `today` подсвечивает текущий день недели (Monday-first ключ, как в схеме).
 */
const ScheduleView = ({
  schedule,
  today,
  className,
}: {
  schedule?: Record<string, Day> | null;
  today?: string;
  className?: string;
}) => (
  <div className={cn("tw:grid tw:grid-cols-7 tw:gap-1.5", className)}>
    {(SCHEDULE_DAYS as [string, string][]).map(([label, key]) => {
      const day = schedule?.[key];
      const off = !day?.isWorking;
      return (
        <div
          key={key}
          title={
            off
              ? `${label}: выходной`
              : day?.is24hours
                ? `${label}: круглосуточно`
                : `${label}: ${day?.start}–${day?.end}` +
                  (day?.breakMinutes ? `, перерыв ${day.breakMinutes} мин` : "")
          }
          className={cn(
            "tw:rounded-lg tw:border tw:border-border-soft tw:px-1 tw:py-2 tw:text-center",
            off ? "tw:bg-muted" : "tw:bg-background",
            today === key && "tw:border-primary",
          )}
        >
          <div className="tw:text-xs tw:tracking-wide tw:text-faint tw:uppercase">
            {label.slice(0, 2)}
          </div>
          <div
            className={cn(
              "tw:mt-1 tw:text-xs tw:tabular-nums",
              off
                ? "tw:text-faint"
                : "tw:font-semibold tw:text-foreground",
            )}
          >
            {off ? (
              "—"
            ) : day?.is24hours ? (
              "24 ч"
            ) : (
              <>
                {day?.start}
                <br />
                {day?.end}
              </>
            )}
          </div>
        </div>
      );
    })}
  </div>
);

export default ScheduleView;
