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
      <p className="tw:my-0 tw:text-sm tw:text-muted-foreground">
        За период нет работ, попадающих в биллинг.
      </p>
    );
  }

  return (
    <>
      <div className="tw:flex tw:h-4.5 tw:gap-0.5">
        {rows.map((status) => (
          <span
            key={status.key}
            title={`${status.label} — ${byStatus[status.key]?.count}`}
            className="tw:block tw:h-full tw:rounded-xs tw:last:rounded-e"
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
      <div className="tw:mt-3.5 tw:flex tw:flex-col tw:gap-2 tw:text-sm tw:tabular-nums">
        {rows.map((status) => (
          <div
            key={status.key}
            className="tw:flex tw:items-baseline tw:justify-between tw:gap-4"
          >
            <span className="tw:inline-flex tw:items-center tw:gap-2">
              <span
                aria-hidden
                className="tw:size-2.5 tw:flex-none tw:rounded-xs"
                style={{
                  background: status.color,
                  opacity:
                    status.key === "preview" || status.key === "none" ? 0.5 : 1,
                }}
              />
              {status.label}
            </span>
            <span className="tw:text-muted-foreground">
              {byStatus[status.key]?.count} ·{" "}
              {formatMinutes(byStatus[status.key]?.minutes ?? 0)}
            </span>
          </div>
        ))}
      </div>
      {note && (
        <p className="tw:mt-3.5 tw:mb-0 tw:text-xs tw:text-faint">{note}</p>
      )}
    </>
  );
};

export default ApprovalPanel;
