import { useState } from "react";
import { useNavigate } from "react-router";
import { RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type {
  EmployeeRow,
  EmployeesTotals,
} from "../../types/employeesReport";

import { formatMinutes, formatMoney, fullName, initials } from "./work-format";

// Таблица сводки: строка ведёт в отчёт сотрудника, своя строка помечена «Вы».
// Сотрудники без работ за период свёрнуты — они не должны отодвигать данные.
type SortKey =
  | "name"
  | "worksCount"
  | "ticketsFinished"
  | "totalMinutes"
  | "overtime"
  | "pay";

const EmployeesTable = ({
  employees,
  totals,
  currentUserId,
}: {
  employees: EmployeeRow[];
  totals: EmployeesTotals;
  currentUserId?: string;
}) => {
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "totalMinutes",
    desc: true,
  });
  const [showIdle, setShowIdle] = useState(false);

  const valueOf = (row: EmployeeRow, key: SortKey): number | string => {
    if (key === "name") return fullName(row.employee);
    if (key === "overtime") return row.overtime.roundedMinutes;
    if (key === "pay") return row.payroll.overtimePay ?? -1;
    return row[key];
  };

  const sorted = [...employees].sort((a, b) => {
    const left = valueOf(a, sort.key);
    const right = valueOf(b, sort.key);
    const compared =
      typeof left === "string" || typeof right === "string"
        ? String(left).localeCompare(String(right), "ru")
        : left - right;
    return sort.desc ? -compared : compared;
  });

  // Свою строку показываем всегда — даже без работ за период
  const active = sorted.filter(
    (row) => row.worksCount > 0 || row.employee._id === currentUserId,
  );
  const idle = sorted.filter(
    (row) => row.worksCount === 0 && row.employee._id !== currentUserId,
  );
  const rows = showIdle ? [...active, ...idle] : active;

  const Th = ({
    columnKey,
    children,
    numeric = true,
  }: {
    columnKey: SortKey;
    children: React.ReactNode;
    numeric?: boolean;
  }) => {
    const isActive = sort.key === columnKey;
    return (
      <TableHead className={cn("tw:whitespace-nowrap", numeric && "tw:text-right")}>
        <button
          type="button"
          onClick={() =>
            setSort({ key: columnKey, desc: isActive ? !sort.desc : true })
          }
          className={cn(
            "tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-0.5 tw:border-0 tw:bg-transparent tw:p-0 tw:text-xs tw:font-semibold tw:whitespace-nowrap tw:outline-none tw:hover:text-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50",
            isActive ? "tw:text-foreground" : "tw:text-muted-foreground",
          )}
        >
          {children}
          {isActive && (
            <RiArrowDownSLine
              size={14}
              aria-hidden
              className={cn("tw:transition-transform", !sort.desc && "tw:rotate-180")}
            />
          )}
        </button>
      </TableHead>
    );
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <Th columnKey="name" numeric={false}>
            Сотрудник
          </Th>
          <Th columnKey="worksCount">Работы</Th>
          <Th columnKey="ticketsFinished">Заявки</Th>
          <TableHead
            className="tw:text-right tw:whitespace-nowrap"
            title="Выезды / удалённые / регламентные"
          >
            Выезд · удал. · регл.
          </TableHead>
          <Th columnKey="totalMinutes">Отработано</Th>
          <TableHead
            className="tw:text-right tw:whitespace-nowrap"
            title="Норма по производственному календарю и личному графику, минус подтверждённые отсутствия"
          >
            Норма
          </TableHead>
          <TableHead className="tw:text-right tw:whitespace-nowrap">Δ</TableHead>
          <Th columnKey="overtime">Переработки</Th>
          <TableHead className="tw:text-right tw:whitespace-nowrap">
            Будни / выходные
          </TableHead>
          <Th columnKey="pay">К доплате</Th>
          <TableHead className="tw:w-6" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const isMe = row.employee._id === currentUserId;
          const overtime = row.overtime.roundedMinutes;
          return (
            <TableRow
              key={row.employee._id}
              onClick={() => navigate(`/finances/employees/${row.employee._id}`)}
              className={cn(
                "tw:cursor-pointer",
                isMe && "tw:bg-primary/7 tw:hover:bg-primary/12",
              )}
            >
              <TableCell>
                <span className="tw:flex tw:items-center tw:gap-2.5">
                  <span className="tw:grid tw:size-8 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-accent tw:text-xs tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
                    {initials(row.employee)}
                  </span>
                  <span className="tw:min-w-0">
                    <span className="tw:flex tw:items-center tw:gap-2 tw:font-medium">
                      <span className="tw:truncate">{fullName(row.employee)}</span>
                      {isMe && (
                        <span className="tw:flex-none tw:rounded-full tw:bg-primary tw:px-2 tw:py-px tw:text-[0.6875rem] tw:font-semibold tw:text-white">
                          Вы
                        </span>
                      )}
                      {!row.employee.isActive && (
                        <span className="tw:flex-none tw:text-xs tw:text-faint">
                          уволен
                        </span>
                      )}
                    </span>
                    <span className="tw:block tw:truncate tw:text-xs tw:text-faint">
                      {row.employee.position || "Должность не указана"}
                    </span>
                  </span>
                </span>
              </TableCell>
              <TableCell className="tw:text-right tw:tabular-nums">
                {row.worksCount}
              </TableCell>
              <TableCell className="tw:text-right tw:tabular-nums">
                {row.ticketsFinished}
              </TableCell>
              <TableCell className="tw:text-right tw:whitespace-nowrap tw:text-muted-foreground tw:tabular-nums">
                {[row.onSite.count, row.remote.count, row.routineTask.count]
                  .map((count) => (count === 0 ? "—" : count))
                  .join(" · ")}
              </TableCell>
              <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
                {formatMinutes(row.totalMinutes)}
              </TableCell>
              <TableCell className="tw:text-right tw:tabular-nums">
                {row.hasPersonalSchedule ? (
                  <span title={`${row.workingDays} рабочих дней · пояс ${row.timezone}`}>
                    {formatMinutes(row.normMinutes)}
                  </span>
                ) : (
                  <span className="tw:text-xs tw:text-warning" title="Переработки считаются по окну обслуживания клиента, как до появления графиков">
                    нет графика
                  </span>
                )}
              </TableCell>
              <TableCell className="tw:text-right tw:tabular-nums">
                {row.hasPersonalSchedule ? (
                  <span
                    className={cn(
                      row.totalMinutes - row.normMinutes >= 0
                        ? "tw:font-semibold tw:text-accent-text"
                        : "tw:text-muted-foreground",
                    )}
                  >
                    {row.totalMinutes - row.normMinutes > 0 ? "+" : ""}
                    {formatMinutes(row.totalMinutes - row.normMinutes)}
                  </span>
                ) : (
                  <span className="tw:text-faint">—</span>
                )}
              </TableCell>
              <TableCell
                className={cn(
                  "tw:text-right tw:tabular-nums",
                  overtime === 0 && "tw:text-faint",
                )}
              >
                {formatMinutes(overtime)}
              </TableCell>
              <TableCell className="tw:text-right tw:whitespace-nowrap tw:text-faint tw:tabular-nums">
                {overtime === 0
                  ? "—"
                  : `${formatMinutes(row.overtime.weekdayMinutes)} / ${formatMinutes(row.overtime.weekendMinutes)}`}
              </TableCell>
              <TableCell className="tw:text-right tw:tabular-nums">
                {row.payroll.missingRate && overtime > 0 ? (
                  <span className="tw:text-warning">нет ставки</span>
                ) : row.payroll.overtimePay ? (
                  <b className="tw:font-semibold">
                    {formatMoney(row.payroll.overtimePay)}
                  </b>
                ) : (
                  <span className="tw:text-faint">—</span>
                )}
              </TableCell>
              <TableCell className="tw:text-faint">
                <RiArrowRightSLine size={16} aria-hidden />
              </TableCell>
            </TableRow>
          );
        })}
        {idle.length > 0 && (
          <TableRow className="tw:hover:bg-transparent">
            {/* 11 = 9 прежних колонок + «Норма» и «Δ» */}
            <TableCell colSpan={11} className="tw:py-2">
              <button
                type="button"
                onClick={() => setShowIdle((current) => !current)}
                className="tw:inline-flex tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:text-muted-foreground tw:outline-none tw:hover:text-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
              >
                <RiArrowRightSLine
                  size={15}
                  aria-hidden
                  className={cn("tw:transition-transform", showIdle && "tw:rotate-90")}
                />
                {showIdle
                  ? "Скрыть сотрудников без работ"
                  : `Ещё ${idle.length} без работ за период`}
              </button>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Итого</TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {totals.worksCount}
          </TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {totals.ticketsFinished}
          </TableCell>
          <TableCell className="tw:text-right tw:whitespace-nowrap tw:text-muted-foreground tw:tabular-nums">
            {[
              totals.onSite.count,
              totals.remote.count,
              totals.routineTask.count,
            ].join(" · ")}
          </TableCell>
          <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
            {formatMinutes(totals.totalMinutes)}
          </TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {formatMinutes(totals.normMinutes)}
          </TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {/* Δ по итогу считаем от нормы: у кого графика нет, норма нулевая
                и в сумму не входит — сноска о них живёт под таблицей */}
            {formatMinutes(totals.totalMinutes - totals.normMinutes)}
          </TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {formatMinutes(totals.overtime.roundedMinutes)}
          </TableCell>
          <TableCell className="tw:text-right tw:whitespace-nowrap tw:text-faint tw:tabular-nums">
            {formatMinutes(totals.overtime.weekdayMinutes)} /{" "}
            {formatMinutes(totals.overtime.weekendMinutes)}
          </TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {formatMoney(totals.overtimePaySum)}
          </TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
};

export default EmployeesTable;
