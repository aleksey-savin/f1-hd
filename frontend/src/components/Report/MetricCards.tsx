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
      className="tw:h-8 tw:w-24 tw:flex-none"
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
  <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:md:grid-cols-3 tw:xl:grid-cols-5">
    {metrics.map((metric) => {
      const isActive = metric.key === active;
      return (
        <button
          key={metric.key}
          type="button"
          aria-pressed={isActive}
          onClick={() => onSelect(metric.key)}
          className={cn(
            "tw:flex tw:cursor-pointer tw:appearance-none tw:flex-col tw:gap-1 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-3.5 tw:text-left tw:transition-colors tw:outline-none tw:hover:bg-accent/50 tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
            isActive &&
              "tw:border-primary tw:ring-1 tw:ring-primary tw:ring-inset tw:hover:bg-card",
          )}
        >
          <span className="tw:text-sm tw:font-medium tw:text-muted-foreground">
            {metric.label}
          </span>
          <span className="tw:flex tw:items-end tw:justify-between tw:gap-2">
            <span
              className={cn(
                "tw:text-lg tw:leading-none tw:font-bold tw:tabular-nums",
                metric.change.percentage === null ||
                  metric.change.direction === "flat"
                  ? "tw:text-faint"
                  : metric.change.direction === "up"
                    ? "tw:text-accent-text"
                    : "tw:text-destructive",
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
