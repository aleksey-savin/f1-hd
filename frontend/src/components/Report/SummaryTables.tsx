import { useState, type ReactNode } from "react";
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
  CompanySummary,
  ReportTotals,
  SubdivisionSummary,
} from "../../types/report";
import { msToHMS } from "../../util/time-helpers";

import BarList, { type BarListRow } from "./BarList";
import { type EmployeeAggregate } from "./employees";

// Таблицы сводки: по компаниям, по сотрудникам, по подразделениям (клиентский
// вид). Общий язык: сортировка кликом по заголовку, «Итого» в подвале,
// детализация — раскрытием строки в bar-list (вместо легаси-аккордеона с
// круговыми диаграммами). Сортировка — локальный state таблицы, в стор не
// уезжает.

type SortDirection = "asc" | "desc";
type SortState<Key extends string> = { key: Key; direction: SortDirection };

const sortRows = <Row, Key extends string>(
  rows: Row[],
  sort: SortState<Key>,
  valueOf: (row: Row, key: Key) => number | string,
) =>
  [...rows].sort((a, b) => {
    const left = valueOf(a, sort.key);
    const right = valueOf(b, sort.key);
    const compared =
      typeof left === "string" || typeof right === "string"
        ? String(left).localeCompare(String(right), "ru")
        : left - right;
    return sort.direction === "asc" ? compared : -compared;
  });

const SortableHead = <Key extends string>({
  columnKey,
  sort,
  onSort,
  numeric = true,
  children,
}: {
  columnKey: Key;
  sort: SortState<Key>;
  onSort: (sort: SortState<Key>) => void;
  numeric?: boolean;
  children: ReactNode;
}) => {
  const isActive = sort.key === columnKey;
  return (
    <TableHead className={cn("tw:whitespace-nowrap", numeric && "tw:text-right")}>
      <button
        type="button"
        onClick={() =>
          onSort({
            key: columnKey,
            direction:
              isActive && sort.direction === "desc" ? "asc" : "desc",
          })
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
            className={cn(
              "tw:transition-transform",
              sort.direction === "asc" && "tw:rotate-180",
            )}
          />
        )}
      </button>
    </TableHead>
  );
};

// Ячейка «кол-во · время»
const CountTimeCell = ({ count, time }: { count: number; time: number }) => (
  <TableCell className="tw:text-right tw:whitespace-nowrap tw:tabular-nums">
    {count} <span className="tw:text-faint">· {msToHMS(time)}</span>
  </TableCell>
);

// Строка с раскрытием: сама строка + строка-детализация c bar-list
const ExpandableRow = ({
  expandable,
  expanded,
  onToggle,
  cells,
  nameCell,
  detail,
  columnsCount,
}: {
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  nameCell: ReactNode;
  cells: ReactNode;
  detail: ReactNode;
  columnsCount: number;
}) => (
  <>
    <TableRow
      onClick={expandable ? onToggle : undefined}
      className={cn(expandable && "tw:cursor-pointer")}
    >
      <TableCell className="tw:font-medium">
        <span className="tw:inline-flex tw:items-center tw:gap-1.5">
          {expandable && (
            <RiArrowRightSLine
              size={15}
              aria-hidden
              className={cn(
                "tw:flex-none tw:text-faint tw:transition-transform",
                expanded && "tw:rotate-90",
              )}
            />
          )}
          {nameCell}
        </span>
      </TableCell>
      {cells}
    </TableRow>
    {expanded && (
      <TableRow className="tw:hover:bg-transparent">
        <TableCell colSpan={columnsCount} className="tw:py-3 tw:ps-9">
          {detail}
        </TableCell>
      </TableRow>
    )}
  </>
);

const useExpanded = () => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { expanded, toggle };
};

// ---------------------------------------------------------------- Компании

type CompanySortKey =
  | "alias"
  | "totalTickets"
  | "totalWorks"
  | "onSite"
  | "remote"
  | "routineTask"
  | "totalTime";

const companyValue = (row: CompanySummary, key: CompanySortKey) => {
  if (key === "alias") return row.company.alias;
  if (key === "onSite" || key === "remote" || key === "routineTask")
    return row[key].time;
  return row[key];
};

export const CompanySummaryTable = ({
  companies,
  totals,
}: {
  companies: CompanySummary[];
  totals: ReportTotals;
}) => {
  const [sort, setSort] = useState<SortState<CompanySortKey>>({
    key: "totalTime",
    direction: "desc",
  });
  const { expanded, toggle } = useExpanded();
  const rows = sortRows(companies, sort, companyValue);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead columnKey="alias" sort={sort} onSort={setSort} numeric={false}>
            Компания
          </SortableHead>
          <SortableHead columnKey="totalTickets" sort={sort} onSort={setSort}>
            Заявки
          </SortableHead>
          <SortableHead columnKey="totalWorks" sort={sort} onSort={setSort}>
            Работы
          </SortableHead>
          <SortableHead columnKey="onSite" sort={sort} onSort={setSort}>
            Выезды
          </SortableHead>
          <SortableHead columnKey="remote" sort={sort} onSort={setSort}>
            Удалённо
          </SortableHead>
          <SortableHead columnKey="routineTask" sort={sort} onSort={setSort}>
            Регламент
          </SortableHead>
          <SortableHead columnKey="totalTime" sort={sort} onSort={setSort}>
            Время всего
          </SortableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const expandable = row.executors.length > 0;
          const executorRows: BarListRow[] = [...row.executors]
            .sort((a, b) => b.totalTime - a.totalTime)
            .map((executor) => ({
              key: executor.name,
              name: executor.name,
              time: executor.totalTime,
            }));
          return (
            <ExpandableRow
              key={row.company._id}
              expandable={expandable}
              expanded={expanded.has(row.company._id)}
              onToggle={() => toggle(row.company._id)}
              columnsCount={7}
              nameCell={row.company.alias}
              detail={<BarList rows={executorRows} />}
              cells={
                <>
                  <TableCell className="tw:text-right tw:tabular-nums">
                    {row.totalTickets}
                  </TableCell>
                  <TableCell className="tw:text-right tw:tabular-nums">
                    {row.totalWorks}
                  </TableCell>
                  <CountTimeCell count={row.onSite.count} time={row.onSite.time} />
                  <CountTimeCell count={row.remote.count} time={row.remote.time} />
                  <CountTimeCell
                    count={row.routineTask.count}
                    time={row.routineTask.time}
                  />
                  <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
                    {msToHMS(row.totalTime)}
                  </TableCell>
                </>
              }
            />
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Итого</TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {totals.totalTickets}
          </TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {totals.totalWorks}
          </TableCell>
          <CountTimeCell count={totals.onSite.count} time={totals.onSite.time} />
          <CountTimeCell count={totals.remote.count} time={totals.remote.time} />
          <CountTimeCell
            count={totals.routineTask.count}
            time={totals.routineTask.time}
          />
          <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
            {msToHMS(totals.totalTime)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
};

// --------------------------------------------------------------- Сотрудники

type EmployeeSortKey =
  | "name"
  | "totalWorks"
  | "onSite"
  | "remote"
  | "routineTask"
  | "totalTime";

const employeeValue = (row: EmployeeAggregate, key: EmployeeSortKey) => {
  if (key === "name") return row.name;
  if (key === "onSite") return row.onSiteTime;
  if (key === "remote") return row.remoteTime;
  if (key === "routineTask") return row.routineTaskTime;
  return row[key];
};

export const EmployeeTable = ({
  employees,
  totals,
}: {
  employees: EmployeeAggregate[];
  totals: ReportTotals;
}) => {
  const [sort, setSort] = useState<SortState<EmployeeSortKey>>({
    key: "totalTime",
    direction: "desc",
  });
  const { expanded, toggle } = useExpanded();
  const rows = sortRows(employees, sort, employeeValue);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead columnKey="name" sort={sort} onSort={setSort} numeric={false}>
            Сотрудник
          </SortableHead>
          <SortableHead columnKey="totalWorks" sort={sort} onSort={setSort}>
            Работы
          </SortableHead>
          <SortableHead columnKey="onSite" sort={sort} onSort={setSort}>
            Выезды
          </SortableHead>
          <SortableHead columnKey="remote" sort={sort} onSort={setSort}>
            Удалённо
          </SortableHead>
          <SortableHead columnKey="routineTask" sort={sort} onSort={setSort}>
            Регламент
          </SortableHead>
          <SortableHead columnKey="totalTime" sort={sort} onSort={setSort}>
            Время всего
          </SortableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const companyRows: BarListRow[] = [...row.companies]
            .sort((a, b) => b.time - a.time)
            .map((company) => ({
              key: company.alias,
              name: company.alias,
              time: company.time,
            }));
          return (
            <ExpandableRow
              key={row.name}
              expandable={row.companies.length > 0}
              expanded={expanded.has(row.name)}
              onToggle={() => toggle(row.name)}
              columnsCount={6}
              nameCell={row.name}
              detail={<BarList rows={companyRows} />}
              cells={
                <>
                  <TableCell className="tw:text-right tw:tabular-nums">
                    {row.totalWorks}
                  </TableCell>
                  <CountTimeCell count={row.onSiteWorks} time={row.onSiteTime} />
                  <CountTimeCell count={row.remoteWorks} time={row.remoteTime} />
                  <CountTimeCell
                    count={row.routineTaskWorks}
                    time={row.routineTaskTime}
                  />
                  <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
                    {msToHMS(row.totalTime)}
                  </TableCell>
                </>
              }
            />
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Итого</TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {totals.totalWorks}
          </TableCell>
          <CountTimeCell count={totals.onSite.count} time={totals.onSite.time} />
          <CountTimeCell count={totals.remote.count} time={totals.remote.time} />
          <CountTimeCell
            count={totals.routineTask.count}
            time={totals.routineTask.time}
          />
          <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
            {msToHMS(totals.totalTime)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
};

// ------------------------------------------------- Подразделения (клиент)

type SubdivisionSortKey =
  | "name"
  | "totalWorks"
  | "onSite"
  | "remote"
  | "routineTask"
  | "totalTime";

const subdivisionValue = (row: SubdivisionSummary, key: SubdivisionSortKey) => {
  if (key === "name") return row.name;
  if (key === "onSite") return row.onSiteTime;
  if (key === "remote") return row.remoteTime;
  if (key === "routineTask") return row.routineTaskTime;
  return row[key];
};

export const ClientSummaryTable = ({
  subdivisions,
  totals,
}: {
  subdivisions: SubdivisionSummary[];
  totals: ReportTotals;
}) => {
  const [sort, setSort] = useState<SortState<SubdivisionSortKey>>({
    key: "totalTime",
    direction: "desc",
  });
  const rows = sortRows(
    // Пустое «Без подразделения» не показываем
    subdivisions.filter((subdivision) => subdivision.totalWorks > 0),
    sort,
    subdivisionValue,
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead columnKey="name" sort={sort} onSort={setSort} numeric={false}>
            Подразделение
          </SortableHead>
          <SortableHead columnKey="totalWorks" sort={sort} onSort={setSort}>
            Работы
          </SortableHead>
          <SortableHead columnKey="onSite" sort={sort} onSort={setSort}>
            Выезды
          </SortableHead>
          <SortableHead columnKey="remote" sort={sort} onSort={setSort}>
            Удалённо
          </SortableHead>
          <SortableHead columnKey="routineTask" sort={sort} onSort={setSort}>
            Регламент
          </SortableHead>
          <SortableHead columnKey="totalTime" sort={sort} onSort={setSort}>
            Время всего
          </SortableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row._id}>
            <TableCell className="tw:font-medium">{row.name}</TableCell>
            <TableCell className="tw:text-right tw:tabular-nums">
              {row.totalWorks}
            </TableCell>
            <CountTimeCell count={row.onSiteCount} time={row.onSiteTime} />
            <CountTimeCell count={row.remoteCount} time={row.remoteTime} />
            <CountTimeCell
              count={row.routineTaskCount}
              time={row.routineTaskTime}
            />
            <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
              {msToHMS(row.totalTime)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Итого</TableCell>
          <TableCell className="tw:text-right tw:tabular-nums">
            {totals.totalWorks}
          </TableCell>
          <CountTimeCell count={totals.onSite.count} time={totals.onSite.time} />
          <CountTimeCell count={totals.remote.count} time={totals.remote.time} />
          <CountTimeCell
            count={totals.routineTask.count}
            time={totals.routineTask.time}
          />
          <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
            {msToHMS(totals.totalTime)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
};
