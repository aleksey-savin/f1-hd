import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SegmentOption = { value: string; label: string; icon?: ReactNode };

// Сегмент-контрол (single-select) — общий стиль с выбором темы: активный сегмент
// tw:bg-primary/15 + accent-text. Для выбора из нескольких взаимоисключающих
// значений (тип тарификации, метод учёта, тип расположения). `stacked` —
// иконка над подписью (компактно для 4–5 вариантов с иконками, влезает и на
// мобайле). appearance/border/bg гасят дефолты кнопки (preflight выключен).
const Segmented = ({
  options,
  value,
  onChange,
  ariaLabel,
  stacked = false,
  className,
}: {
  options: readonly SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  stacked?: boolean;
  className?: string;
}) => {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "tw:flex tw:gap-0.5 tw:rounded-lg tw:border tw:border-input tw:bg-transparent tw:p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "tw:inline-flex tw:flex-1 tw:cursor-pointer tw:appearance-none tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:font-semibold tw:text-muted-foreground tw:transition-colors tw:outline-none tw:hover:text-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
            stacked
              ? "tw:flex-col tw:gap-1 tw:px-1.5 tw:py-2 tw:text-center tw:text-xs tw:leading-tight"
              : "tw:gap-1.5 tw:px-3 tw:py-2 tw:text-sm",
            value === option.value &&
              "tw:bg-primary/15 tw:text-accent-text tw:hover:text-accent-text",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
};

export default Segmented;
