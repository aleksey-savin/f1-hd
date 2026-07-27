import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { msToHMS } from "../../util/time-helpers";

import { deltaOf } from "./delta";
import { type AggregatedPeriod } from "./trends";

// Таблица «По периодам»: итоги каждого периода по всей выборке, Δ — к
// предыдущему периоду (стрелка дублирует цвет, не только цвет).
const DeltaCell = ({ current, previous }: { current: number; previous: number | null }) => {
  const delta = previous === null ? null : deltaOf(current, previous);
  return (
    <TableCell
      className={cn(
        "tw:text-right tw:whitespace-nowrap tw:tabular-nums",
        !delta || delta.percentage === null || delta.direction === "flat"
          ? "tw:text-faint"
          : delta.direction === "up"
            ? "tw:text-accent-text"
            : "tw:text-destructive",
      )}
    >
      {!delta || delta.percentage === null || delta.direction === "flat"
        ? "—"
        : `${delta.direction === "up" ? "↑" : "↓"} ${Math.abs(delta.percentage)}%`}
    </TableCell>
  );
};

const TrendsTable = ({ periods }: { periods: AggregatedPeriod[] }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className="tw:whitespace-nowrap">Период</TableHead>
        <TableHead className="tw:text-right">Время работ</TableHead>
        <TableHead className="tw:text-right">Δ</TableHead>
        <TableHead className="tw:text-right">Заявки</TableHead>
        <TableHead className="tw:text-right">Δ</TableHead>
        <TableHead className="tw:text-right">Работы</TableHead>
        <TableHead className="tw:text-right">Выезды</TableHead>
        <TableHead className="tw:text-right">Удалённо</TableHead>
        <TableHead className="tw:text-right">Регламент</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {periods.map((period, index) => {
        const previous = index > 0 ? periods[index - 1].totals : null;
        return (
          <TableRow key={period.key}>
            <TableCell className="tw:font-medium tw:whitespace-nowrap">
              {period.label}
            </TableCell>
            <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
              {msToHMS(period.totals.totalTime)}
            </TableCell>
            <DeltaCell
              current={period.totals.totalTime}
              previous={previous ? previous.totalTime : null}
            />
            <TableCell className="tw:text-right tw:tabular-nums">
              {period.totals.totalTickets}
            </TableCell>
            <DeltaCell
              current={period.totals.totalTickets}
              previous={previous ? previous.totalTickets : null}
            />
            <TableCell className="tw:text-right tw:tabular-nums">
              {period.totals.totalWorks}
            </TableCell>
            <TableCell className="tw:text-right tw:tabular-nums">
              {msToHMS(period.totals.onSite.time)}
            </TableCell>
            <TableCell className="tw:text-right tw:tabular-nums">
              {msToHMS(period.totals.remote.time)}
            </TableCell>
            <TableCell className="tw:text-right tw:tabular-nums">
              {msToHMS(period.totals.routineTask.time)}
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);

export default TrendsTable;
