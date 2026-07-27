import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Статборд-плитка KPI: подпись → значение крупно → произвольное тело →
// строка дельты → сноска. Извлечена из «Активности» карточки компании
// (Company/View/ActivityTiles); её же делит KPI-ряд отчёта «Аналитика».
// `busy` приглушает плитку на время фоновой подгрузки среза.

// Строка дельты: направление несут и цвет, и знак (не только цвет); нет базы
// или без изменений — приглушённый «—». `hint` называет базу сравнения
// («к прошлому периоду», «к среднему 12/мес»).
export const StatTileDelta = ({
  direction,
  percentage,
  hint,
  unit = "%",
}: {
  direction: "up" | "down" | "flat";
  percentage: number | null;
  hint: ReactNode;
  /** Единица дельты: доли сравниваются в пунктах, а не в процентах от процента. */
  unit?: string;
}) => (
  <div className="tw:mt-1.5 tw:text-sm tw:tabular-nums">
    {percentage === null || direction === "flat" ? (
      <span className="tw:font-semibold tw:text-faint">—</span>
    ) : (
      <span
        className={cn(
          "tw:font-semibold",
          direction === "up" ? "tw:text-accent-text" : "tw:text-destructive",
        )}
      >
        {percentage > 0 ? "+" : ""}
        {percentage}
        {unit}
      </span>
    )}{" "}
    <span className="tw:text-faint">{hint}</span>
  </div>
);

const StatTile = ({
  label,
  value,
  delta,
  footer,
  busy = false,
  className,
  children,
}: {
  label: ReactNode;
  /** Крупное значение (text-3xl, tabular). Нестандартное тело — через children. */
  value?: ReactNode;
  /** Обычно <StatTileDelta …>. */
  delta?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  className?: string;
  children?: ReactNode;
}) => (
  <div
    className={cn(
      "tw:flex tw:flex-col tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-4 tw:transition-opacity",
      busy && "tw:opacity-60",
      className,
    )}
  >
    <div className="tw:text-sm tw:font-medium tw:text-muted-foreground">
      {label}
    </div>
    {value != null && (
      <div className="tw:mt-2 tw:text-3xl tw:leading-none tw:font-bold tw:tracking-tight tw:tabular-nums">
        {value}
      </div>
    )}
    {children}
    {delta}
    {footer != null && (
      <div className="tw:mt-1.5 tw:text-xs tw:text-faint tw:tabular-nums">
        {footer}
      </div>
    )}
  </div>
);

export default StatTile;
