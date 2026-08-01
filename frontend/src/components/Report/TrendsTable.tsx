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
const DeltaCell = ({
  current,
  previous,
}: {
  current: number;
  previous: number | null;
}) => {
  const delta = previous === null ? null : deltaOf(current, previous);
  return (
    <TableCell
      className={cn(
        "text-right whitespace-nowrap tabular-nums",
        !delta || delta.percentage === null || delta.direction === "flat"
          ? "text-faint"
          : delta.direction === "up"
            ? "text-accent-text"
            : "text-destructive",
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
        <TableHead className="whitespace-nowrap">Период</TableHead>
        <TableHead className="text-right">Время работ</TableHead>
        <TableHead className="text-right">Δ</TableHead>
        <TableHead className="text-right">Заявки</TableHead>
        <TableHead className="text-right">Δ</TableHead>
        <TableHead className="text-right">Работы</TableHead>
        <TableHead className="text-right">Выезды</TableHead>
        <TableHead className="text-right">Удалённо</TableHead>
        <TableHead className="text-right">Регламент</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {periods.map((period, index) => {
        const previous = index > 0 ? periods[index - 1].totals : null;
        return (
          <TableRow key={period.key}>
            <TableCell className="font-medium whitespace-nowrap">
              {period.label}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {msToHMS(period.totals.totalTime)}
            </TableCell>
            <DeltaCell
              current={period.totals.totalTime}
              previous={previous ? previous.totalTime : null}
            />
            <TableCell className="text-right tabular-nums">
              {period.totals.totalTickets}
            </TableCell>
            <DeltaCell
              current={period.totals.totalTickets}
              previous={previous ? previous.totalTickets : null}
            />
            <TableCell className="text-right tabular-nums">
              {period.totals.totalWorks}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {msToHMS(period.totals.onSite.time)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {msToHMS(period.totals.remote.time)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {msToHMS(period.totals.routineTask.time)}
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);

export default TrendsTable;
