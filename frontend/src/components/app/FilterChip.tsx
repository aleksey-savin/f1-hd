import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Чип-фильтр из согласованного макета: пилюля с точкой-индикатором,
// во включённом состоянии — бирюзовая подложка. `size="sm"` — компактный
// (28 px, 12-й кегль) для рядов внутри панелей: поповер уведомлений.
// `count` — число рядом с подписью (непрочитанные вида), без него ничего.
const FilterChip = ({
  active = false,
  onClick,
  children,
  className,
  size = "md",
  count,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  size?: "md" | "sm";
  count?: number | null;
}) => {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer appearance-none items-center rounded-full border border-input bg-transparent font-semibold text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50",
        size === "md" ? "h-10 gap-2 px-4 text-sm" : "h-7 gap-1.5 px-2.5 text-xs",
        active &&
          "border-transparent bg-primary/15 text-accent-text hover:bg-primary/20",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full bg-faint", active && "bg-primary")}
      />
      {children}
      {count != null && count > 0 && (
        <span
          className={cn(
            "font-normal tabular-nums",
            active ? "text-accent-text" : "text-faint",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
};

export default FilterChip;
