import { msToHMS } from "../../util/time-helpers";

// Bar-list раскрытой строки таблицы: имя · тонкая полоска · время. Величина
// одна (magnitude) — один оттенок (chart-1), без категориальной раскраски.
export type BarListRow = {
  key: string;
  name: string;
  time: number;
  /** Приглушённая строка-хвост («ещё 4 компании»). */
  muted?: boolean;
};

const BarList = ({ rows }: { rows: BarListRow[] }) => {
  const max = Math.max(...rows.map((row) => row.time), 1);

  return (
    <div className="tw:flex tw:flex-col tw:gap-1.5">
      {rows.map((row) => (
        <div key={row.key} className="tw:flex tw:items-center tw:gap-3">
          <span
            className={
              row.muted
                ? "tw:w-40 tw:flex-none tw:truncate tw:text-sm tw:text-faint"
                : "tw:w-40 tw:flex-none tw:truncate tw:text-sm tw:text-muted-foreground"
            }
            title={row.name}
          >
            {row.name}
          </span>
          <span className="tw:h-2 tw:flex-1">
            <span
              className="tw:block tw:h-full tw:rounded-full"
              style={{
                width: `${(row.time / max) * 100}%`,
                background: "var(--chart-1)",
                opacity: row.muted ? 0.35 : 0.85,
              }}
            />
          </span>
          <span className="tw:w-14 tw:flex-none tw:text-right tw:text-sm tw:text-muted-foreground tw:tabular-nums">
            {msToHMS(row.time)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default BarList;
