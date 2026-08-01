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

type ShareBarRow = {
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
    return <p className="my-0 text-sm text-muted-foreground">{emptyText}</p>;
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
      <div className="flex flex-col gap-2.5">
        {shown.map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[1fr_5rem_3.5rem] items-center gap-3"
          >
            <span
              className={cn("truncate text-sm", row.muted && "text-faint")}
              title={row.label}
            >
              {row.label}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-chart-1"
                style={{
                  width: `${(row.value / max) * 100}%`,
                  opacity: row.muted ? 0.35 : 0.85,
                }}
              />
            </span>
            <span className="text-right text-sm text-muted-foreground tabular-nums">
              {format(row.value)}
            </span>
          </div>
        ))}
      </div>
      {rows.length > collapseAfter && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-3 text-accent-text"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Свернуть" : `Показать все ${rows.length}`}
        </Button>
      )}
    </>
  );
};

export default ShareBars;
