import type { ComponentProps, Ref } from "react";

import { RiCalendarLine, RiCloseLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

/**
 * Кнопка-поле календаря: выглядит как Input/Combobox (h-10, rounded-lg,
 * border-input) и открывает Popover с Calendar. Внутренний примитив для
 * DateField / DateRangeField / DateTimeField — на экранах не используется.
 *
 * Крестик очистки — отдельная кнопка-сосед (DateClearButton), а не вложенная:
 * button внутри button невалиден. Обёртка поля — `relative`, крестик стоит
 * absolute перед иконкой календаря, подпись отступает под него (`clearable`).
 */
type DateTriggerProps = Omit<ComponentProps<"button">, "children"> & {
  ref?: Ref<HTMLButtonElement>;
  label: string | null;
  placeholder: string;
  /** Оставить справа место под крестик очистки. */
  clearable?: boolean;
  invalid?: boolean;
};

const DateTrigger = ({
  ref,
  label,
  placeholder,
  clearable = false,
  invalid = false,
  className,
  ...props
}: DateTriggerProps) => (
  <button
    ref={ref}
    type="button"
    data-slot="date-trigger"
    aria-invalid={invalid || undefined}
    // appearance/border/bg заданы явно, как у Combobox: браузерные дефолты
    // <button> в проекте не сбрасываются. Высота и радиус — как у ui/Input.
    className={cn(
      "flex h-10 w-full appearance-none items-center gap-2 rounded-lg",
      "border border-input bg-background px-3 text-left text-sm text-foreground",
      "hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
      "aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
      "disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  >
    <span
      className={cn(
        "min-w-0 flex-1 truncate tabular-nums",
        clearable && "pe-7",
        !label && "text-muted-foreground",
      )}
    >
      {label || placeholder}
    </span>
    <RiCalendarLine className="flex-none text-faint" size={16} aria-hidden />
  </button>
);

export const DateClearButton = ({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) => (
  <button
    type="button"
    aria-label="Очистить"
    onClick={onClick}
    className={cn(
      "absolute top-1/2 right-9 grid size-6 -translate-y-1/2 cursor-pointer appearance-none place-items-center rounded-md border-0 bg-transparent text-faint transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50",
      className,
    )}
  >
    <RiCloseLine size={14} aria-hidden />
  </button>
);

export default DateTrigger;
