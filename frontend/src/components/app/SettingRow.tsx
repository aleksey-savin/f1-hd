import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Строка настройки в панели: (опц. плитка-иконка) · название + подсказка ·
// контрол справа. На узких экранах складывается в столбец, контрол занимает
// всю ширину. Разделитель между соседними строками — prop divider.
const SettingRow = ({
  title,
  hint,
  leading,
  divider = false,
  className,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** Плитка-иконка слева (например, логотип интеграции). */
  leading?: ReactNode;
  /** Тонкая линия сверху — между соседними строками. */
  divider?: boolean;
  className?: string;
  children?: ReactNode;
}) => {
  return (
    <div
      className={cn(
        "tw:flex tw:items-center tw:gap-4 tw:px-5 tw:py-4",
        "tw:max-md:flex-col tw:max-md:items-stretch tw:max-md:gap-3",
        divider && "tw:border-t tw:border-border-soft",
        className,
      )}
    >
      {leading && (
        <span
          aria-hidden
          className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border tw:max-md:hidden"
        >
          {leading}
        </span>
      )}
      <div className="tw:min-w-0">
        <div className="tw:text-base tw:font-medium">{title}</div>
        {hint && (
          <div className="tw:mt-0.5 tw:text-sm tw:text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      {children && (
        <div className="tw:ms-auto tw:flex-none tw:max-md:ms-0">{children}</div>
      )}
    </div>
  );
};

export default SettingRow;
