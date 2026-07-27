import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { msToHMS } from "../../util/time-helpers";

import { formatMinutes } from "./work-format";

// Разрез одной величины: имя · полоса · время. Одна величина — один оттенок
// (chart-1), без категориальной раскраски. Раньше это были два почти
// одинаковых компонента (BarList в миллисекундах и ShareList в минутах); после
// объединения отчётов они оказались на одной странице, поэтому единица стала
// пропом, а компонент — общим. Длинный список сворачивается.

export type ShareBarRow = {
  key: string;
  label: string;
  value: number;
  /** Приглушённая строка-хвост («Ещё 4 компании»). */
  muted?: boolean;
};

const ShareBars = ({
  rows,
  unit = "minutes",
  collapseAfter = 6,
  emptyText = "За период данных нет.",
}: {
  rows: ShareBarRow[];
  /** «count» — величина не время (например, число заявок). */
  unit?: "minutes" | "ms" | "count";
  collapseAfter?: number;
  emptyText?: string;
}) => {
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) {
    return (
      <p className="tw:my-0 tw:text-sm tw:text-muted-foreground">{emptyText}</p>
    );
  }

  const format =
    unit === "ms"
      ? msToHMS
      : unit === "count"
        ? (value: number) => String(value)
        : formatMinutes;
  const max = Math.max(...rows.map((row) => row.value), 1);
  const shown = expanded ? rows : rows.slice(0, collapseAfter);

  return (
    <>
      <div className="tw:flex tw:flex-col tw:gap-2.5">
        {shown.map((row) => (
          <div
            key={row.key}
            className="tw:grid tw:grid-cols-[1fr_5rem_3.5rem] tw:items-center tw:gap-3"
          >
            <span
              className={cn(
                "tw:truncate tw:text-sm",
                row.muted && "tw:text-faint",
              )}
              title={row.label}
            >
              {row.label}
            </span>
            <span className="tw:h-2 tw:overflow-hidden tw:rounded-full tw:bg-muted">
              <span
                className="tw:block tw:h-full tw:rounded-full tw:bg-chart-1"
                style={{
                  width: `${(row.value / max) * 100}%`,
                  opacity: row.muted ? 0.35 : 0.85,
                }}
              />
            </span>
            <span className="tw:text-right tw:text-sm tw:text-muted-foreground tw:tabular-nums">
              {format(row.value)}
            </span>
          </div>
        ))}
      </div>
      {rows.length > collapseAfter && (
        <Button
          variant="ghost"
          size="xs"
          className="tw:mt-3 tw:text-accent-text"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Свернуть" : `Показать все ${rows.length}`}
        </Button>
      )}
    </>
  );
};

export default ShareBars;
