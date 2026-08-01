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
      <div className="flex h-4.5 gap-0.5">
        {WORK_CLASSES.map((item) => {
          const minutes = classes[item.key].minutes;
          if (minutes <= 0) return null;
          return (
            <span
              key={item.key}
              title={`${item.label} — ${formatMinutes(minutes)}`}
              className="block h-full rounded-xs last:rounded-e"
              style={{
                width: total > 0 ? `${(minutes / total) * 100}%` : "0%",
                background: item.color,
              }}
            />
          );
        })}
        {total === 0 && (
          <span className="block h-full w-full rounded-xs bg-muted" />
        )}
      </div>
      <div
        className={
          compact
            ? "mt-3 flex flex-col gap-1 text-sm text-muted-foreground tabular-nums"
            : "mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-muted-foreground tabular-nums"
        }
      >
        {WORK_CLASSES.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 flex-none rounded-xs"
              style={{ background: item.color }}
            />
            <span>
              <b className="font-semibold text-foreground">
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
