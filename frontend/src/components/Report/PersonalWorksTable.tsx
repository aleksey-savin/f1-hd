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

import {
  WORK_CLASSES,
  WORK_CLASS_LABEL,
  financeStatusMeta,
  formatMinutes,
} from "./work-format";

// Список работ периода: когда, у кого, по какой заявке, сколько и попало ли в
// согласованный отчёт. Статус — цветной текст с точкой, а не заливной бейдж.
const PAGE = 15;

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

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
            <TableHead className="tw:whitespace-nowrap">Когда</TableHead>
            <TableHead className="tw:whitespace-nowrap">Компания</TableHead>
            <TableHead>Заявка и описание</TableHead>
            <TableHead className="tw:whitespace-nowrap">Вид</TableHead>
            <TableHead className="tw:text-right tw:whitespace-nowrap">
              Длительность
            </TableHead>
            <TableHead className="tw:text-right tw:whitespace-nowrap">
              Переработка
            </TableHead>
            <TableHead className="tw:whitespace-nowrap">Согласование</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((work) => {
            const status = financeStatusMeta(work.financesStatus);
            const muted = status.key === "preview" || status.key === "none";
            return (
              <TableRow key={work._id}>
                <TableCell className="tw:whitespace-nowrap tw:tabular-nums">
                  {dateTime.format(new Date(work.startedAt))}–
                  {timeOnly.format(new Date(work.finishedAt))}
                </TableCell>
                <TableCell className="tw:whitespace-nowrap">
                  {work.company?.alias ?? "—"}
                </TableCell>
                <TableCell className="tw:min-w-64">
                  <span className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
                    {work.tickets.map((ticket) => (
                      <Link
                        key={ticket._id}
                        to={`/tickets/${ticket.num}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="tw:font-semibold tw:text-accent-text tw:no-underline tw:tabular-nums tw:hover:underline"
                      >
                        №{ticket.num}
                      </Link>
                    ))}
                    <span className="tw:line-clamp-1 tw:text-muted-foreground">
                      {work.description || "без описания"}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="tw:whitespace-nowrap">
                  <span className="tw:inline-flex tw:items-center tw:gap-2">
                    <span
                      aria-hidden
                      className="tw:size-2 tw:flex-none tw:rounded-xs"
                      style={{ background: classColor(work) }}
                    />
                    {WORK_CLASS_LABEL[work.workClass]}
                  </span>
                </TableCell>
                <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
                  {formatMinutes(work.durationMinutes)}
                </TableCell>
                <TableCell
                  className={cn(
                    "tw:text-right tw:tabular-nums",
                    work.overtime.roundedMinutes > 0
                      ? "tw:text-warning"
                      : "tw:text-faint",
                  )}
                >
                  {work.overtime.roundedMinutes > 0
                    ? formatMinutes(work.overtime.roundedMinutes)
                    : "—"}
                </TableCell>
                <TableCell className="tw:whitespace-nowrap">
                  <span
                    className={cn(
                      "tw:inline-flex tw:items-center tw:gap-2",
                      muted ? "tw:text-muted-foreground" : "tw:text-accent-text",
                    )}
                  >
                    <span
                      aria-hidden
                      className="tw:size-2 tw:flex-none tw:rounded-full"
                      style={{ background: status.color, opacity: muted ? 0.5 : 1 }}
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
            <TableCell className="tw:text-muted-foreground tw:tabular-nums">
              {works.length} работ
            </TableCell>
            <TableCell />
            <TableCell className="tw:text-right tw:font-semibold tw:tabular-nums">
              {formatMinutes(totalMinutes)}
            </TableCell>
            <TableCell className="tw:text-right tw:tabular-nums">
              {formatMinutes(overtimeMinutes)}
            </TableCell>
            <TableCell className="tw:text-faint tw:tabular-nums">
              {approvedCount} из {works.length} утверждены
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {shown < works.length && (
        <div className="tw:px-2 tw:pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="tw:text-accent-text"
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
