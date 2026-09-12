import { useState } from "react";
import { useNavigate } from "react-router";
import { RiArrowRightSLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import type { EmployeeRow } from "../../types/employeesReport";

import { formatMinutes, formatMoney, fullName, initials } from "./work-format";

// Мобильный вид сводки: таблица не помещается — строка-карточка отвечает на
// те же вопросы. Как и таблица, не форкается под режим: в «Статистике» правая
// колонка показывает загрузку к норме, в «Переработках» — доплату.
//
// Без права `user.manageFinances` доплаты нет вовсе — вторая строка справа
// показывает загрузку к норме, как в «Статистике», а не пустой прочерк.
const EmployeesCards = ({
  employees,
  currentUserId,
  variant = "stats",
  canSeeMoney = false,
}: {
  employees: EmployeeRow[];
  currentUserId?: string;
  variant?: "stats" | "overtime";
  canSeeMoney?: boolean;
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
    <div className="px-3.5">
      {rows.map((row) => {
        const isMe = row.employee._id === currentUserId;
        const overtime = row.overtime.roundedMinutes;
        return (
          <button
            key={row.employee._id}
            type="button"
            onClick={() => navigate(`/finances/employees/${row.employee._id}`)}
            className="flex w-full cursor-pointer appearance-none items-center gap-2.5 border-0 border-t border-border-soft bg-transparent px-0 py-3 text-left first:border-t-0 focus-visible:ring-4 focus-visible:ring-ring/50"
          >
            <span className="grid size-9 flex-none place-items-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border">
              {initials(row.employee)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">
                  {fullName(row.employee)}
                </span>
                {isMe && (
                  <span className="flex-none rounded-full bg-primary px-2 py-px text-xs font-semibold text-white">
                    Вы
                  </span>
                )}
              </span>
              <span className="block truncate text-xs text-faint tabular-nums">
                {row.worksCount} работ · {row.ticketsFinished} заявок
                {overtime > 0
                  ? ` · переработки ${formatMinutes(overtime)}`
                  : ""}
              </span>
            </span>
            <span className="flex-none text-right">
              <span className="block font-semibold tabular-nums">
                {formatMinutes(row.totalMinutes)}
              </span>
              {variant === "overtime" && canSeeMoney ? (
                <span
                  className={cn(
                    "block text-xs tabular-nums",
                    row.payroll.missingRate && overtime > 0
                      ? "text-warning"
                      : "text-faint",
                  )}
                >
                  {row.payroll.missingRate && overtime > 0
                    ? "нет ставки"
                    : row.payroll.overtimePay
                      ? formatMoney(row.payroll.overtimePay)
                      : "—"}
                </span>
              ) : (
                <span
                  className={cn(
                    "block text-xs tabular-nums",
                    row.utilizationPercent !== null &&
                      row.utilizationPercent >= 90
                      ? "text-accent-text"
                      : "text-faint",
                  )}
                >
                  {row.utilizationPercent === null
                    ? "нет графика"
                    : `${row.utilizationPercent}% к норме`}
                </span>
              )}
            </span>
            <RiArrowRightSLine
              size={16}
              aria-hidden
              className="flex-none text-faint"
            />
          </button>
        );
      })}
      {idle.length > 0 && (
        <button
          type="button"
          onClick={() => setShowIdle((current) => !current)}
          className="flex w-full cursor-pointer appearance-none items-center justify-between border-0 border-t border-border-soft bg-transparent px-0 py-3 text-left text-sm text-muted-foreground focus-visible:ring-4 focus-visible:ring-ring/50"
        >
          {showIdle ? "Скрыть без работ" : `Ещё ${idle.length} без работ`}
          <RiArrowRightSLine
            size={16}
            aria-hidden
            className={cn(
              "text-faint transition-transform",
              showIdle && "rotate-90",
            )}
          />
        </button>
      )}
    </div>
  );
};

export default EmployeesCards;
