import { useState, type ReactNode } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";

import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { msToHMS } from "../../util/time-helpers";

// Общий язык таблиц отчётов: сортировка кликом по заголовку, ячейка
// «кол-во · время», строка с раскрытием в детализацию. Делят таблицы обоих
// отчётов («Компании» и «Сотрудники»), поэтому живут отдельно от конкретной
// таблицы. Сортировка — локальный state таблицы, в стор не уезжает.

export type SortDirection = "asc" | "desc";
export type SortState<Key extends string> = {
  key: Key;
  direction: SortDirection;
};

export const sortRows = <Row, Key extends string>(
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

export const SortableHead = <Key extends string>({
  columnKey,
  sort,
  onSort,
  numeric = true,
  title,
  children,
}: {
  columnKey: Key;
  sort: SortState<Key>;
  onSort: (sort: SortState<Key>) => void;
  numeric?: boolean;
  title?: string;
  children: ReactNode;
}) => {
  const isActive = sort.key === columnKey;
  return (
    <TableHead
      className={cn("tw:whitespace-nowrap", numeric && "tw:text-right")}
      title={title}
    >
      <button
        type="button"
        onClick={() =>
          onSort({
            key: columnKey,
            direction: isActive && sort.direction === "desc" ? "asc" : "desc",
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

/** Ячейка «кол-во · время». */
export const CountTimeCell = ({
  count,
  time,
}: {
  count: number;
  time: number;
}) => (
  <TableCell className="tw:text-right tw:whitespace-nowrap tw:tabular-nums">
    {count} <span className="tw:text-faint">· {msToHMS(time)}</span>
  </TableCell>
);

/** Строка с раскрытием: сама строка + строка-детализация. */
export const ExpandableRow = ({
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

export const useExpanded = () => {
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
