import { cn } from "@/lib/utils";

// Легенда классов работ — цвет закреплён за классом на всей странице:
// Выезды chart-1, Удалённо chart-2, Регламент chart-3 (те же слоты читают
// стек-бары через ChartConfig).
const WORK_CLASS_SERIES = [
  { key: "onSite", label: "Выезды", color: "var(--chart-1)" },
  { key: "remote", label: "Удалённо", color: "var(--chart-2)" },
  { key: "routineTask", label: "Регламент", color: "var(--chart-3)" },
] as const;

const ClassLegend = ({ className }: { className?: string }) => (
  <span
    className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}
  >
    {WORK_CLASS_SERIES.map((series) => (
      <span
        key={series.key}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <span
          aria-hidden
          className="size-2.5 rounded-xs"
          style={{ background: series.color }}
        />
        {series.label}
      </span>
    ))}
  </span>
);

export default ClassLegend;
