import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Чип-фильтр из согласованного макета: пилюля с точкой-индикатором,
// во включённом состоянии — бирюзовая подложка.
const FilterChip = ({
  active = false,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) => {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 cursor-pointer appearance-none items-center gap-2 rounded-full border border-input bg-transparent px-4 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50",
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
    </button>
  );
};

export default FilterChip;
