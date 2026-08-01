import { RiArrowRightSLine } from "react-icons/ri";

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

import type { ReportTotals, SubdivisionRow } from "../../types/report";
import { msToHMS } from "../../util/time-helpers";

import { CountTimeCell } from "./table-kit";

// Подразделения компании деревом: узлы идут в порядке обхода, вложенность
// показана отступом. Строка «Без подразделения» — не декорация: работы, чей
// заявитель не привязан к филиалу, обязаны быть видимы, иначе сумма по
// подразделениям молча разойдётся с итогом компании (так и было до правки).

const NAME_INDENT = 18;

/** Дерево в плоский список: родитель, за ним его поддерево. */
const flatten = (rows: SubdivisionRow[]) => {
  const byParent = new Map<string | null, SubdivisionRow[]>();
  for (const row of rows) {
    const key = row.parentId ? String(row.parentId) : null;
    const bucket = byParent.get(key) ?? [];
    bucket.push(row);
    byParent.set(key, bucket);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => b.subtree.totalTime - a.subtree.totalTime);
  }

  const known = new Set(rows.map((row) => row._id));
  const ordered: SubdivisionRow[] = [];

  const walk = (parentId: string | null) => {
    for (const row of byParent.get(parentId) || []) {
      ordered.push(row);
      walk(row._id);
    }
  };

  walk(null);
  // Узлы, чей родитель не попал в выборку (нет данных у ветки выше), — корнями,
  // иначе они пропали бы из таблицы целиком
  for (const row of rows) {
    if (
      !ordered.includes(row) &&
      (!row.parentId || !known.has(String(row.parentId)))
    ) {
      ordered.push(row);
    }
  }
  return ordered;
};

const SubdivisionsTable = ({
  subdivisions,
  unassigned,
  totals,
  onOpen,
}: {
  subdivisions: SubdivisionRow[];
  unassigned: ReportTotals | null;
  totals: ReportTotals;
  onOpen?: (subdivisionId: string) => void;
}) => {
  const rows = flatten(subdivisions);
  const minDepth = rows.length ? Math.min(...rows.map((row) => row.depth)) : 0;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Подразделение</TableHead>
          <TableHead className="text-right">Заявки</TableHead>
          <TableHead className="text-right">Работы</TableHead>
          <TableHead className="text-right">Выезды</TableHead>
          <TableHead className="text-right">Удалённо</TableHead>
          <TableHead className="text-right">Регламент</TableHead>
          <TableHead className="text-right whitespace-nowrap">Время</TableHead>
          <TableHead className="w-6" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row._id}
            onClick={onOpen ? () => onOpen(row._id) : undefined}
            className={cn(onOpen && "cursor-pointer")}
          >
            <TableCell>
              <span
                className="flex items-center gap-2"
                style={{
                  paddingInlineStart: (row.depth - minDepth) * NAME_INDENT,
                }}
              >
                {row.depth > minDepth && (
                  <span aria-hidden className="text-faint">
                    └
                  </span>
                )}
                <span className="truncate font-medium">{row.name}</span>
                {row.subtree.totalTime !== row.totalTime && (
                  <span className="text-xs text-faint whitespace-nowrap">
                    с вложенными {msToHMS(row.subtree.totalTime)}
                  </span>
                )}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.totalTickets}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.totalWorks}
            </TableCell>
            <CountTimeCell count={row.onSite.count} time={row.onSite.time} />
            <CountTimeCell count={row.remote.count} time={row.remote.time} />
            <CountTimeCell
              count={row.routineTask.count}
              time={row.routineTask.time}
            />
            <TableCell className="text-right font-semibold tabular-nums">
              {msToHMS(row.totalTime)}
            </TableCell>
            <TableCell className="text-faint">
              {onOpen && <RiArrowRightSLine size={16} aria-hidden />}
            </TableCell>
          </TableRow>
        ))}

        {unassigned && unassigned.totalWorks > 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell>
              <span className="flex items-center gap-2 text-muted-foreground">
                Без подразделения
                <span className="text-xs text-faint">
                  заявитель не привязан к филиалу
                </span>
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {unassigned.totalTickets}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {unassigned.totalWorks}
            </TableCell>
            <CountTimeCell
              count={unassigned.onSite.count}
              time={unassigned.onSite.time}
            />
            <CountTimeCell
              count={unassigned.remote.count}
              time={unassigned.remote.time}
            />
            <CountTimeCell
              count={unassigned.routineTask.count}
              time={unassigned.routineTask.time}
            />
            <TableCell className="text-right font-medium tabular-nums text-muted-foreground">
              {msToHMS(unassigned.totalTime)}
            </TableCell>
            <TableCell />
          </TableRow>
        )}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Итого</TableCell>
          <TableCell className="text-right tabular-nums">
            {totals.totalTickets}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {totals.totalWorks}
          </TableCell>
          <CountTimeCell
            count={totals.onSite.count}
            time={totals.onSite.time}
          />
          <CountTimeCell
            count={totals.remote.count}
            time={totals.remote.time}
          />
          <CountTimeCell
            count={totals.routineTask.count}
            time={totals.routineTask.time}
          />
          <TableCell className="text-right font-semibold tabular-nums">
            {msToHMS(totals.totalTime)}
          </TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
};

export default SubdivisionsTable;
