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
  <div className={cn("grid grid-cols-7 gap-1.5", className)}>
    {(SCHEDULE_DAYS as [string, string, string][]).map(
      ([label, key, short]) => {
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
                    (day?.breakMinutes
                      ? `, перерыв ${day.breakMinutes} мин`
                      : "")
            }
            className={cn(
              "rounded-lg border border-border-soft px-1 py-2 text-center",
              off ? "bg-muted" : "bg-background",
              today === key && "border-primary",
            )}
          >
            {/* Короткая подпись — из каталога дней: обрезка полной по две буквы
              давала «Че», «Пя», «Су», «Во» */}
            <div className="text-xs tracking-wide text-faint uppercase">
              {short}
            </div>
            <div
              className={cn(
                "mt-1 text-xs tabular-nums",
                off ? "text-faint" : "font-semibold text-foreground",
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
      },
    )}
  </div>
);

export default ScheduleView;
