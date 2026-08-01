import { useState, type ReactNode } from "react";
import { RiArrowDownSLine } from "react-icons/ri";

import { TableCell, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { msToHMS } from "../../util/time-helpers";

// Общий язык таблиц отчётов: сортировка кликом по заголовку и ячейка
// «кол-во · время». Делят таблицы обоих отчётов («Компании» и «Сотрудники»),
// поэтому живут отдельно от конкретной таблицы. Сортировка — локальный state
// таблицы, в стор не уезжает.

type SortDirection = "asc" | "desc";
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
      className={cn("whitespace-nowrap", numeric && "text-right")}
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
          "inline-flex cursor-pointer appearance-none items-center gap-0.5 border-0 bg-transparent p-0 text-xs font-semibold whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
        {isActive && (
          <RiArrowDownSLine
            size={14}
            aria-hidden
            className={cn(
              "transition-transform",
              sort.direction === "asc" && "rotate-180",
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
  <TableCell className="text-right whitespace-nowrap tabular-nums">
    {count} <span className="text-faint">· {msToHMS(time)}</span>
  </TableCell>
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
