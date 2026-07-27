import { useState } from "react";
import { useNavigate } from "react-router";
import { RiArrowRightSLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import type { EmployeeRow } from "../../types/employeesReport";

import { formatMinutes, formatMoney, fullName, initials } from "./work-format";

// Мобильный вид сводки: таблица не помещается — строка-карточка отвечает на
// те же вопросы (сколько отработал, есть ли переработки, сколько к доплате).
const EmployeesCards = ({
  employees,
  currentUserId,
}: {
  employees: EmployeeRow[];
  currentUserId?: string;
}) => {
  const navigate = useNavigate();
  const [showIdle, setShowIdle] = useState(false);

  const sorted = [...employees].sort((a, b) => b.totalMinutes - a.totalMinutes);
  const active = sorted.filter(
    (row) => row.worksCount > 0 || row.employee._id === currentUserId,
  );
  const idle = sorted.filter(
    (row) => row.worksCount === 0 && row.employee._id !== currentUserId,
  );
  const rows = showIdle ? [...active, ...idle] : active;

  return (
    <div className="tw:px-3.5">
      {rows.map((row) => {
        const isMe = row.employee._id === currentUserId;
        const overtime = row.overtime.roundedMinutes;
        return (
          <button
            key={row.employee._id}
            type="button"
            onClick={() => navigate(`/finances/employees/${row.employee._id}`)}
            className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2.5 tw:border-0 tw:border-t tw:border-border-soft tw:bg-transparent tw:px-0 tw:py-3 tw:text-left tw:first:border-t-0 tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
          >
            <span className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-accent tw:text-xs tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
              {initials(row.employee)}
            </span>
            <span className="tw:min-w-0 tw:flex-1">
              <span className="tw:flex tw:items-center tw:gap-2">
                <span className="tw:truncate tw:font-medium">
                  {fullName(row.employee)}
                </span>
                {isMe && (
                  <span className="tw:flex-none tw:rounded-full tw:bg-primary tw:px-2 tw:py-px tw:text-xs tw:font-semibold tw:text-white">
                    Вы
                  </span>
                )}
              </span>
              <span className="tw:block tw:truncate tw:text-xs tw:text-faint tw:tabular-nums">
                {row.worksCount} работ · {row.ticketsFinished} заявок
                {overtime > 0 ? ` · переработки ${formatMinutes(overtime)}` : ""}
              </span>
            </span>
            <span className="tw:flex-none tw:text-right">
              <span className="tw:block tw:font-semibold tw:tabular-nums">
                {formatMinutes(row.totalMinutes)}
              </span>
              <span
                className={cn(
                  "tw:block tw:text-xs tw:tabular-nums",
                  row.payroll.missingRate && overtime > 0
                    ? "tw:text-warning"
                    : "tw:text-faint",
                )}
              >
                {row.payroll.missingRate && overtime > 0
                  ? "нет ставки"
                  : row.payroll.overtimePay
                    ? formatMoney(row.payroll.overtimePay)
                    : "—"}
              </span>
            </span>
            <RiArrowRightSLine
              size={16}
              aria-hidden
              className="tw:flex-none tw:text-faint"
            />
          </button>
        );
      })}
      {idle.length > 0 && (
        <button
          type="button"
          onClick={() => setShowIdle((current) => !current)}
          className="tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:justify-between tw:border-0 tw:border-t tw:border-border-soft tw:bg-transparent tw:px-0 tw:py-3 tw:text-left tw:text-sm tw:text-muted-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
        >
          {showIdle ? "Скрыть без работ" : `Ещё ${idle.length} без работ`}
          <RiArrowRightSLine
            size={16}
            aria-hidden
            className={cn(
              "tw:text-faint tw:transition-transform",
              showIdle && "tw:rotate-90",
            )}
          />
        </button>
      )}
    </div>
  );
};

export default EmployeesCards;
