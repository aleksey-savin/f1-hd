import { cn } from "@/lib/utils";

import { type Delta } from "./delta";

// Карточки метрик «Динамики»: одновременно сводка (изменение первый →
// последний период + спарклайн «Итого») и переключатель главного графика.
// Активная — рамка primary; спарклайн активной — primary, остальных — faint.
// Ключ метрики — произвольная строка: компонент делят «Компании» и
// «Сотрудники», наборы метрик у них разные.

const Spark = ({ values, active }: { values: number[]; active: boolean }) => {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (value, index) =>
        `${(2 + (index * 116) / (values.length - 1)).toFixed(1)},${(
          30 -
          ((value - min) / span) * 26
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 120 34"
      preserveAspectRatio="none"
      aria-hidden
      className="h-8 w-24 flex-none"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        stroke={active ? "var(--primary)" : "var(--faint)"}
      />
    </svg>
  );
};

export type MetricCard = {
  key: string;
  label: string;
  change: Delta;
  spark: number[];
};

const MetricCards = ({
  metrics,
  active,
  onSelect,
}: {
  metrics: MetricCard[];
  active: string;
  onSelect: (key: string) => void;
}) => (
  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
    {metrics.map((metric) => {
      const isActive = metric.key === active;
      return (
        <button
          key={metric.key}
          type="button"
          aria-pressed={isActive}
          onClick={() => onSelect(metric.key)}
          className={cn(
            "flex cursor-pointer appearance-none flex-col gap-1 rounded-xl border border-border bg-card p-3.5 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:ring-4 focus-visible:ring-ring/50",
            isActive &&
              "border-primary ring-1 ring-primary ring-inset hover:bg-card",
          )}
        >
          <span className="text-sm font-medium text-muted-foreground">
            {metric.label}
          </span>
          <span className="flex items-end justify-between gap-2">
            <span
              className={cn(
                "text-lg leading-none font-bold tabular-nums",
                metric.change.percentage === null ||
                  metric.change.direction === "flat"
                  ? "text-faint"
                  : metric.change.direction === "up"
                    ? "text-accent-text"
                    : "text-destructive",
              )}
            >
              {metric.change.percentage === null ||
              metric.change.direction === "flat"
                ? "—"
                : `${metric.change.percentage > 0 ? "+" : ""}${metric.change.percentage}%`}
            </span>
            <Spark values={metric.spark} active={isActive} />
          </span>
        </button>
      );
    })}
  </div>
);

export default MetricCards;
