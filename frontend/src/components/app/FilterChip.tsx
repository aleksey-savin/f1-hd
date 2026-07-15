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
        "tw:inline-flex tw:h-10 tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-input tw:bg-transparent tw:px-4 tw:text-sm tw:font-semibold tw:text-muted-foreground tw:transition-colors tw:outline-none tw:hover:bg-accent tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
        active &&
          "tw:border-transparent tw:bg-primary/15 tw:text-accent-text tw:hover:bg-primary/20",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "tw:size-1.5 tw:rounded-full tw:bg-faint",
          active && "tw:bg-primary",
        )}
      />
      {children}
    </button>
  );
};

export default FilterChip;
