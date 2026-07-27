import { useState } from "react";

import { Button } from "@/components/ui/button";

import { formatMinutes } from "./work-format";

// Разрез времени по компаниям/категориям: имя · полоса · время. Длинный
// список свёрнут до нескольких строк — правило длинных списков на карточках.
export type ShareRow = { key: string; label: string; minutes: number };

const COLLAPSED = 6;

const ShareList = ({ rows }: { rows: ShareRow[] }) => {
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(...rows.map((row) => row.minutes), 1);
  const shown = expanded ? rows : rows.slice(0, COLLAPSED);

  if (rows.length === 0) {
    return (
      <p className="tw:my-0 tw:text-sm tw:text-muted-foreground">
        За период данных нет.
      </p>
    );
  }

  return (
    <>
      <div className="tw:flex tw:flex-col tw:gap-2.5">
        {shown.map((row) => (
          <div
            key={row.key}
            className="tw:grid tw:grid-cols-[1fr_5rem_3.5rem] tw:items-center tw:gap-3"
          >
            <span className="tw:truncate tw:text-sm" title={row.label}>
              {row.label}
            </span>
            <span className="tw:h-2 tw:overflow-hidden tw:rounded-full tw:bg-muted">
              <span
                className="tw:block tw:h-full tw:rounded-full tw:bg-chart-1"
                style={{ width: `${(row.minutes / max) * 100}%`, opacity: 0.85 }}
              />
            </span>
            <span className="tw:text-right tw:text-sm tw:text-muted-foreground tw:tabular-nums">
              {formatMinutes(row.minutes)}
            </span>
          </div>
        ))}
      </div>
      {rows.length > COLLAPSED && (
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

export default ShareList;
