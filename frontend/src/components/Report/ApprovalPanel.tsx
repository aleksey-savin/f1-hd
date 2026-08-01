import type { FinanceStatusKey, StatusStat } from "../../types/employeesReport";

import { FINANCE_STATUSES, formatMinutes } from "./work-format";

// Согласование работ: полоса статусов + строки со счётчиками. Отвечает на
// вопрос «что уже утверждено, а что ещё может измениться» — раньше это было
// видно только бухгалтеру в сводном отчёте.
const ApprovalPanel = ({
  byStatus,
  note,
}: {
  byStatus: Partial<Record<FinanceStatusKey, StatusStat>>;
  note?: string;
}) => {
  const rows = FINANCE_STATUSES.filter(
    (status) => (byStatus[status.key]?.count ?? 0) > 0,
  );
  const total = rows.reduce(
    (sum, status) => sum + (byStatus[status.key]?.count ?? 0),
    0,
  );

  if (total === 0) {
    return (
      <p className="my-0 text-sm text-muted-foreground">
        За период нет работ, попадающих в биллинг.
      </p>
    );
  }

  return (
    <>
      <div className="flex h-4.5 gap-0.5">
        {rows.map((status) => (
          <span
            key={status.key}
            title={`${status.label} — ${byStatus[status.key]?.count}`}
            className="block h-full rounded-xs last:rounded-e"
            style={{
              width: `${((byStatus[status.key]?.count ?? 0) / total) * 100}%`,
              background: status.color,
              // Превью и «вне биллинга» — приглушённые: это не состояние, а его
              // отсутствие
              opacity:
                status.key === "preview" || status.key === "none" ? 0.45 : 1,
            }}
          />
        ))}
      </div>
      <div className="mt-3.5 flex flex-col gap-2 text-sm tabular-nums">
        {rows.map((status) => (
          <div
            key={status.key}
            className="flex items-baseline justify-between gap-4"
          >
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 flex-none rounded-xs"
                style={{
                  background: status.color,
                  opacity:
                    status.key === "preview" || status.key === "none" ? 0.5 : 1,
                }}
              />
              {status.label}
            </span>
            <span className="text-muted-foreground">
              {byStatus[status.key]?.count} ·{" "}
              {formatMinutes(byStatus[status.key]?.minutes ?? 0)}
            </span>
          </div>
        ))}
      </div>
      {note && <p className="mt-3.5 mb-0 text-xs text-faint">{note}</p>}
    </>
  );
};

export default ApprovalPanel;
