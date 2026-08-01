import { RiCheckLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import { plural } from "./PipelineRail";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { formatWeekdayDateTime } from "../../util/format-date";
import { msToHMS } from "../../util/time-helpers";
import { formatMoney } from "./work-format";

/**
 * Таблица работ отчёта. Их две — «в нерабочее время» и «в рабочее время», как
 * было на прежнем экране.
 *
 * Это не один список с фильтром: наборы ВЫЧИСЛЯЕМЫЕ. Работа, начатая в 17:00 и
 * законченная в 20:00, попадает в обе таблицы разными кусками, а работа с
 * нулевой длительностью — ни в одну. Фасет поверх общего списка этого выразить
 * не может.
 *
 * Раскладка фиксированная, ширины заданы в шапке, перенос включён в КАЖДОЙ
 * ячейке: у `ui/table` ячейка по умолчанию `whitespace-nowrap`, и без явного
 * переноса длинный текст вылезал на соседнюю колонку и уводил таблицу в
 * горизонтальный скролл.
 *
 * Длительность — из расчёта (`billedMinutes`), а не размах отметок: в рабочее
 * время попадает только та часть смены, что укладывается в окно обслуживания.
 */

// Одна строка на шапку и ячейку — разъехаться они не могут
const NUM = "text-right tabular-nums";

const fullName = (person?: { firstName?: string; lastName?: string }) =>
  person ? `${person.lastName || ""} ${person.firstName || ""}`.trim() : "";

const initiators = (work: any) =>
  (work.tickets || [])
    .map((ticket: any) => fullName(ticket.applicantId))
    .filter(Boolean)
    .join(", ") || "—";

const Tickets = ({ work }: { work: any }) => (
  <span className="flex flex-wrap gap-x-2 gap-y-0.5">
    {(work.tickets || []).map((ticket: any) => (
      <a
        key={ticket._id}
        href={`/tickets/${ticket.num}`}
        target="_blank"
        rel="noreferrer"
        className="text-accent-text no-underline tabular-nums hover:underline"
      >
        {ticket.num}
      </a>
    ))}
  </span>
);

const ReportWorksTable = ({
  works,
  showCost = false,
  action,
  footnote,
  tone,
  totalLabel,
}: {
  works: any[];
  showCost?: boolean;
  /** Действие в конце строки — им пользуются работы вне услуг. */
  action?: (work: any) => React.ReactNode;
  footnote?: React.ReactNode;
  /** "warning" — блок требует вмешательства и блокирует движение отчёта. */
  tone?: "warning";
  /** Подпись итога: при фильтре по подразделению итог считается по нему. */
  totalLabel?: string;
}) => {
  const totalMinutes = works.reduce(
    (sum, work) => sum + (work.billedMinutes || 0),
    0,
  );
  const totalCost = works.reduce((sum, work) => sum + (work.cost || 0), 0);

  return (
    <div
      className={cn(
        "rounded-xl border bg-card",
        // Блокирующий блок обязан отличаться от обычной таблицы: он не «ещё
        // одна секция», а причина, по которой отчёт не сформировать
        tone === "warning"
          ? "border-warning ring-1 ring-warning/30 ring-inset"
          : "border-border",
      )}
    >
      {/* Десктоп — таблица: проверка отчёта это сверка колонок, глаз идёт по
          длительностям и суммам сверху вниз */}
      <div className="hidden px-2 py-1.5 lg:block">
        <Table className="table-fixed">
          <TableHeader>
            {/* Ширины подобраны под ЗАГОЛОВКИ, а не только под данные: у
                TableHead стоит whitespace-nowrap, и слишком узкая колонка
                («Длительность» ~116px в объявленных 96) распирала таблицу —
                обёртка Table всегда overflow-x-auto, отсюда и появлялась
                полоса прокрутки при визуально помещающемся содержимом.
                Плюс перенос в шапке: тогда узкая колонка переносит подпись,
                а не ломает раскладку. */}
            <TableRow>
              <TableHead className="w-24 whitespace-normal">Заявки</TableHead>
              <TableHead className="w-40 whitespace-normal">
                Инициаторы
              </TableHead>
              <TableHead className="whitespace-normal">
                Описание работ
              </TableHead>
              <TableHead className="w-36 whitespace-normal">
                Исполнитель
              </TableHead>
              <TableHead className="w-36 whitespace-normal">Начало</TableHead>
              <TableHead className={cn("w-32 whitespace-normal", NUM)}>
                Длительность
              </TableHead>
              {showCost && (
                <TableHead className={cn("w-28 whitespace-normal", NUM)}>
                  Стоимость
                </TableHead>
              )}
              {action && <TableHead className="w-48" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {works.map((work) => (
              <TableRow
                key={work._id}
                // Работы дочерних подразделений уже подписаны — они здесь
                // контекст, а не предмет решения. Подсветка тихая: выделять
                // надо то, что требует внимания, а это как раз наоборот
                className={cn(work.subdivisionApproved && "bg-primary/5")}
              >
                <TableCell className="align-top whitespace-normal">
                  <Tickets work={work} />
                </TableCell>
                <TableCell className="align-top text-sm break-words whitespace-normal">
                  {initiators(work)}
                  {/* Подразделение — свойство заявителя, поэтому живёт в его
                      ячейке: отдельная колонка была бы восьмой и вернула бы
                      горизонтальный скролл */}
                  {work.subdivision?.name && (
                    <span className="block text-xs text-faint">
                      {work.subdivision.name}
                      {work.subdivisionApproved && (
                        <span className="ms-1.5 inline-flex items-center gap-0.5 font-semibold text-accent-text">
                          <RiCheckLine size={11} />
                          согласовано
                        </span>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="align-top font-medium break-words whitespace-normal">
                  {work.description || "—"}
                </TableCell>
                <TableCell className="align-top text-sm break-words whitespace-normal">
                  {fullName(work.finishedBy) || "—"}
                </TableCell>
                <TableCell className="align-top text-sm tabular-nums whitespace-normal">
                  {formatWeekdayDateTime(work.startedAt)}
                </TableCell>
                <TableCell className={cn("align-top", NUM)}>
                  {msToHMS((work.billedMinutes || 0) * 60000)}
                </TableCell>
                {showCost && (
                  <TableCell className={cn("align-top", NUM)}>
                    {formatMoney(work.cost || 0)}
                  </TableCell>
                )}
                {action && (
                  <TableCell className="align-top text-right">
                    {action(work)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="text-base font-semibold">
              <TableCell colSpan={5}>
                {totalLabel || "Итого"} · {works.length}{" "}
                {plural(works.length, ["работа", "работы", "работ"])}
              </TableCell>
              <TableCell className={NUM}>
                {msToHMS(totalMinutes * 60000)}
              </TableCell>
              {showCost && (
                <TableCell className={NUM}>{formatMoney(totalCost)}</TableCell>
              )}
              {action && <TableCell />}
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Узкий экран — запись вместо строки таблицы: шесть колонок на 360px
          не живут ни при каких ширинах */}
      <div className="px-4 py-1 lg:hidden">
        {works.map((work) => (
          <div
            key={work._id}
            className={cn(
              "border-t border-border-soft py-3 first:border-t-0",
              work.subdivisionApproved && "-mx-2 bg-primary/5 px-2",
            )}
          >
            <div className="font-medium break-words">
              {work.description || "—"}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-sm text-muted-foreground tabular-nums">
              <Tickets work={work} />
              <span className="break-words">
                {initiators(work)}
                {work.subdivision?.name && ` · ${work.subdivision.name}`}
              </span>
              {work.subdivisionApproved && (
                <span className="inline-flex items-center gap-0.5 font-semibold text-accent-text">
                  <RiCheckLine size={11} />
                  согласовано
                </span>
              )}
              <span>{fullName(work.finishedBy) || "—"}</span>
              <span>{formatWeekdayDateTime(work.startedAt)}</span>
              <b className="ms-auto font-semibold text-foreground">
                {msToHMS((work.billedMinutes || 0) * 60000)}
              </b>
              {showCost && (
                <b className="font-semibold text-foreground">
                  {formatMoney(work.cost || 0)}
                </b>
              )}
            </div>
            {action && <div className="mt-2">{action(work)}</div>}
          </div>
        ))}
        <div className="flex items-baseline gap-3 border-t border-border py-3 text-base font-semibold tabular-nums">
          <span>
            {totalLabel || "Итого"} · {works.length}{" "}
            {plural(works.length, ["работа", "работы", "работ"])}
          </span>
          <span className="ms-auto">{msToHMS(totalMinutes * 60000)}</span>
          {showCost && <span>{formatMoney(totalCost)}</span>}
        </div>
      </div>

      {footnote && (
        <div
          className={cn(
            "border-t px-4 py-2.5 text-sm",
            tone === "warning"
              ? "border-warning/30 bg-warning/10 text-foreground"
              : "border-border-soft text-muted-foreground",
          )}
        >
          {footnote}
        </div>
      )}
    </div>
  );
};

export default ReportWorksTable;
