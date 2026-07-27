import type { WorkClassStat } from "../../types/employeesReport";

import { WORK_CLASSES, formatMinutes } from "./work-format";

// Полоса классов работ + подписи: «12 выездов · 22:25». Отвечает на вопрос
// «чем занимался» одной строкой — вместо трёх отдельных панелей.
const ClassBar = ({
  classes,
  compact = false,
}: {
  classes: Record<"onSite" | "remote" | "routineTask", WorkClassStat>;
  /** Мобильная раскладка: подписи в столбик. */
  compact?: boolean;
}) => {
  const total = WORK_CLASSES.reduce(
    (sum, item) => sum + classes[item.key].minutes,
    0,
  );

  return (
    <>
      <div className="tw:flex tw:h-4.5 tw:gap-0.5">
        {WORK_CLASSES.map((item) => {
          const minutes = classes[item.key].minutes;
          if (minutes <= 0) return null;
          return (
            <span
              key={item.key}
              title={`${item.label} — ${formatMinutes(minutes)}`}
              className="tw:block tw:h-full tw:rounded-xs tw:last:rounded-e"
              style={{
                width: total > 0 ? `${(minutes / total) * 100}%` : "0%",
                background: item.color,
              }}
            />
          );
        })}
        {total === 0 && (
          <span className="tw:block tw:h-full tw:w-full tw:rounded-xs tw:bg-muted" />
        )}
      </div>
      <div
        className={
          compact
            ? "tw:mt-3 tw:flex tw:flex-col tw:gap-1 tw:text-sm tw:text-muted-foreground tw:tabular-nums"
            : "tw:mt-3 tw:flex tw:flex-wrap tw:gap-x-6 tw:gap-y-1.5 tw:text-sm tw:text-muted-foreground tw:tabular-nums"
        }
      >
        {WORK_CLASSES.map((item) => (
          <span key={item.key} className="tw:inline-flex tw:items-center tw:gap-2">
            <span
              aria-hidden
              className="tw:size-2.5 tw:flex-none tw:rounded-xs"
              style={{ background: item.color }}
            />
            <span>
              <b className="tw:font-semibold tw:text-foreground">
                {classes[item.key].count}
              </b>{" "}
              {item.plural} · {formatMinutes(classes[item.key].minutes)}
            </span>
          </span>
        ))}
      </div>
    </>
  );
};

export default ClassBar;
