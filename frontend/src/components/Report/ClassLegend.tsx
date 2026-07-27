import { cn } from "@/lib/utils";

// Легенда классов работ — цвет закреплён за классом на всей странице:
// Выезды chart-1, Удалённо chart-2, Регламент chart-3 (те же слоты читают
// стек-бары через ChartConfig).
export const WORK_CLASS_SERIES = [
  { key: "onSite", label: "Выезды", color: "var(--chart-1)" },
  { key: "remote", label: "Удалённо", color: "var(--chart-2)" },
  { key: "routineTask", label: "Регламент", color: "var(--chart-3)" },
] as const;

const ClassLegend = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1",
      className,
    )}
  >
    {WORK_CLASS_SERIES.map((series) => (
      <span
        key={series.key}
        className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:text-muted-foreground"
      >
        <span
          aria-hidden
          className="tw:size-2.5 tw:rounded-xs"
          style={{ background: series.color }}
        />
        {series.label}
      </span>
    ))}
  </span>
);

export default ClassLegend;
