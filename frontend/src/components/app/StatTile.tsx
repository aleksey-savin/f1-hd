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
  <div className="mt-1.5 text-sm tabular-nums">
    {percentage === null || direction === "flat" ? (
      <span className="font-semibold text-faint">—</span>
    ) : (
      <span
        className={cn(
          "font-semibold",
          direction === "up" ? "text-accent-text" : "text-destructive",
        )}
      >
        {percentage > 0 ? "+" : ""}
        {percentage}
        {unit}
      </span>
    )}{" "}
    <span className="text-faint">{hint}</span>
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
      "flex flex-col rounded-xl border border-border bg-card p-4 transition-opacity",
      busy && "opacity-60",
      className,
    )}
  >
    <div className="text-sm font-medium text-muted-foreground">{label}</div>
    {value != null && (
      <div className="mt-2 text-3xl leading-none font-bold tracking-tight tabular-nums">
        {value}
      </div>
    )}
    {children}
    {delta}
    {footer != null && (
      <div className="mt-1.5 text-xs text-faint tabular-nums">{footer}</div>
    )}
  </div>
);

export default StatTile;
