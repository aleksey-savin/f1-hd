import { useState } from "react";
import { Link } from "react-router";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PersonalWork } from "../../types/employeesReport";

import { formatDayMonthTime, formatTime } from "../../util/format-date";
import {
  WORK_CLASSES,
  WORK_CLASS_LABEL,
  financeStatusMeta,
  formatMinutes,
} from "./work-format";

// Список работ периода: когда, у кого, по какой заявке, сколько и попало ли в
// согласованный отчёт. Статус — цветной текст с точкой, а не заливной бейдж.
const PAGE = 15;

const classColor = (work: PersonalWork) =>
  WORK_CLASSES.find((item) => item.key === work.workClass)?.color ??
  "var(--faint)";

const PersonalWorksTable = ({
  works,
  totalMinutes,
  overtimeMinutes,
  approvedCount,
}: {
  works: PersonalWork[];
  totalMinutes: number;
  overtimeMinutes: number;
  approvedCount: number;
}) => {
  const [shown, setShown] = useState(PAGE);
  const rows = works.slice(0, shown);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Когда</TableHead>
            <TableHead className="whitespace-nowrap">Компания</TableHead>
            <TableHead>Заявка и описание</TableHead>
            <TableHead className="whitespace-nowrap">Вид</TableHead>
            <TableHead className="text-right whitespace-nowrap">
              Длительность
            </TableHead>
            <TableHead className="text-right whitespace-nowrap">
              Переработка
            </TableHead>
            <TableHead className="whitespace-nowrap">Согласование</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((work) => {
            const status = financeStatusMeta(work.financesStatus);
            const muted = status.key === "preview" || status.key === "none";
            return (
              <TableRow key={work._id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatDayMonthTime(work.startedAt)}–
                  {formatTime(work.finishedAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {work.company?.alias ?? "—"}
                </TableCell>
                <TableCell className="min-w-64">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {work.tickets.map((ticket) => (
                      <Link
                        key={ticket._id}
                        to={`/tickets/${ticket.num}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="font-semibold text-accent-text no-underline tabular-nums hover:underline"
                      >
                        {ticket.num}
                      </Link>
                    ))}
                    <span className="line-clamp-1 text-muted-foreground">
                      {work.description || "без описания"}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 flex-none rounded-xs"
                      style={{ background: classColor(work) }}
                    />
                    {WORK_CLASS_LABEL[work.workClass]}
                  </span>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMinutes(work.durationMinutes)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    work.overtime.roundedMinutes > 0
                      ? "text-warning"
                      : "text-faint",
                  )}
                >
                  {work.overtime.roundedMinutes > 0
                    ? formatMinutes(work.overtime.roundedMinutes)
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span
                    className={cn(
                      "inline-flex items-center gap-2",
                      muted ? "text-muted-foreground" : "text-accent-text",
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-2 flex-none rounded-full"
                      style={{
                        background: status.color,
                        opacity: muted ? 0.5 : 1,
                      }}
                    />
                    {status.label}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Итого</TableCell>
            <TableCell />
            <TableCell className="text-muted-foreground tabular-nums">
              {works.length} работ
            </TableCell>
            <TableCell />
            <TableCell className="text-right font-semibold tabular-nums">
              {formatMinutes(totalMinutes)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMinutes(overtimeMinutes)}
            </TableCell>
            <TableCell className="text-faint tabular-nums">
              {approvedCount} из {works.length} утверждены
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {shown < works.length && (
        <div className="px-2 pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-accent-text"
            onClick={() => setShown((current) => current + PAGE)}
          >
            Показать ещё {Math.min(PAGE, works.length - shown)} из{" "}
            {works.length - shown}
          </Button>
        </div>
      )}
    </>
  );
};

export default PersonalWorksTable;
