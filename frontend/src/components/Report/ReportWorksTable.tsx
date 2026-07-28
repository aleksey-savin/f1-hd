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
const NUM = "tw:text-right tw:tabular-nums";

const fullName = (person?: { firstName?: string; lastName?: string }) =>
  person ? `${person.lastName || ""} ${person.firstName || ""}`.trim() : "";

const initiators = (work: any) =>
  (work.tickets || [])
    .map((ticket: any) => fullName(ticket.applicantId))
    .filter(Boolean)
    .join(", ") || "—";

const Tickets = ({ work }: { work: any }) => (
  <span className="tw:flex tw:flex-wrap tw:gap-x-2 tw:gap-y-0.5">
    {(work.tickets || []).map((ticket: any) => (
      <a
        key={ticket._id}
        href={`/tickets/${ticket.num}`}
        target="_blank"
        rel="noreferrer"
        className="tw:text-accent-text tw:no-underline tw:tabular-nums tw:hover:underline"
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
        "tw:rounded-xl tw:border tw:bg-card",
        // Блокирующий блок обязан отличаться от обычной таблицы: он не «ещё
        // одна секция», а причина, по которой отчёт не сформировать
        tone === "warning"
          ? "tw:border-warning tw:ring-1 tw:ring-warning/30 tw:ring-inset"
          : "tw:border-border",
      )}
    >
      {/* Десктоп — таблица: проверка отчёта это сверка колонок, глаз идёт по
          длительностям и суммам сверху вниз */}
      <div className="tw:hidden tw:px-2 tw:py-1.5 tw:lg:block">
        <Table className="tw:table-fixed">
          <TableHeader>
            {/* Ширины подобраны под ЗАГОЛОВКИ, а не только под данные: у
                TableHead стоит whitespace-nowrap, и слишком узкая колонка
                («Длительность» ~116px в объявленных 96) распирала таблицу —
                обёртка Table всегда overflow-x-auto, отсюда и появлялась
                полоса прокрутки при визуально помещающемся содержимом.
                Плюс перенос в шапке: тогда узкая колонка переносит подпись,
                а не ломает раскладку. */}
            <TableRow>
              <TableHead className="tw:w-24 tw:whitespace-normal">Заявки</TableHead>
              <TableHead className="tw:w-40 tw:whitespace-normal">
                Инициаторы
              </TableHead>
              <TableHead className="tw:whitespace-normal">Описание работ</TableHead>
              <TableHead className="tw:w-36 tw:whitespace-normal">
                Исполнитель
              </TableHead>
              <TableHead className="tw:w-36 tw:whitespace-normal">Начало</TableHead>
              <TableHead className={cn("tw:w-32 tw:whitespace-normal", NUM)}>
                Длительность
              </TableHead>
              {showCost && (
                <TableHead className={cn("tw:w-28 tw:whitespace-normal", NUM)}>
                  Стоимость
                </TableHead>
              )}
              {action && <TableHead className="tw:w-48" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {works.map((work) => (
              <TableRow
                key={work._id}
                // Работы дочерних подразделений уже подписаны — они здесь
                // контекст, а не предмет решения. Подсветка тихая: выделять
                // надо то, что требует внимания, а это как раз наоборот
                className={cn(work.subdivisionApproved && "tw:bg-primary/5")}
              >
                <TableCell className="tw:align-top tw:whitespace-normal">
                  <Tickets work={work} />
                </TableCell>
                <TableCell className="tw:align-top tw:text-sm tw:break-words tw:whitespace-normal">
                  {initiators(work)}
                  {/* Подразделение — свойство заявителя, поэтому живёт в его
                      ячейке: отдельная колонка была бы восьмой и вернула бы
                      горизонтальный скролл */}
                  {work.subdivision?.name && (
                    <span className="tw:block tw:text-xs tw:text-faint">
                      {work.subdivision.name}
                      {work.subdivisionApproved && (
                        <span className="tw:ms-1.5 tw:inline-flex tw:items-center tw:gap-0.5 tw:font-semibold tw:text-accent-text">
                          <RiCheckLine size={11} />
                          согласовано
                        </span>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tw:align-top tw:font-medium tw:break-words tw:whitespace-normal">
                  {work.description || "—"}
                </TableCell>
                <TableCell className="tw:align-top tw:text-sm tw:break-words tw:whitespace-normal">
                  {fullName(work.finishedBy) || "—"}
                </TableCell>
                <TableCell className="tw:align-top tw:text-sm tw:tabular-nums tw:whitespace-normal">
                  {formatWeekdayDateTime(work.startedAt)}
                </TableCell>
                <TableCell className={cn("tw:align-top", NUM)}>
                  {msToHMS((work.billedMinutes || 0) * 60000)}
                </TableCell>
                {showCost && (
                  <TableCell className={cn("tw:align-top", NUM)}>
                    {formatMoney(work.cost || 0)}
                  </TableCell>
                )}
                {action && (
                  <TableCell className="tw:align-top tw:text-right">
                    {action(work)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="tw:text-base tw:font-semibold">
              <TableCell colSpan={5}>
                {totalLabel || "Итого"} · {works.length}{" "}
                {plural(works.length, ["работа", "работы", "работ"])}
              </TableCell>
              <TableCell className={NUM}>{msToHMS(totalMinutes * 60000)}</TableCell>
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
      <div className="tw:px-4 tw:py-1 tw:lg:hidden">
        {works.map((work) => (
          <div
            key={work._id}
            className={cn(
              "tw:border-t tw:border-border-soft tw:py-3 tw:first:border-t-0",
              work.subdivisionApproved && "tw:-mx-2 tw:bg-primary/5 tw:px-2",
            )}
          >
            <div className="tw:font-medium tw:break-words">
              {work.description || "—"}
            </div>
            <div className="tw:mt-1 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2.5 tw:gap-y-0.5 tw:text-sm tw:text-muted-foreground tw:tabular-nums">
              <Tickets work={work} />
              <span className="tw:break-words">
                {initiators(work)}
                {work.subdivision?.name && ` · ${work.subdivision.name}`}
              </span>
              {work.subdivisionApproved && (
                <span className="tw:inline-flex tw:items-center tw:gap-0.5 tw:font-semibold tw:text-accent-text">
                  <RiCheckLine size={11} />
                  согласовано
                </span>
              )}
              <span>{fullName(work.finishedBy) || "—"}</span>
              <span>{formatWeekdayDateTime(work.startedAt)}</span>
              <b className="tw:ms-auto tw:font-semibold tw:text-foreground">
                {msToHMS((work.billedMinutes || 0) * 60000)}
              </b>
              {showCost && (
                <b className="tw:font-semibold tw:text-foreground">
                  {formatMoney(work.cost || 0)}
                </b>
              )}
            </div>
            {action && <div className="tw:mt-2">{action(work)}</div>}
          </div>
        ))}
        <div className="tw:flex tw:items-baseline tw:gap-3 tw:border-t tw:border-border tw:py-3 tw:text-base tw:font-semibold tw:tabular-nums">
          <span>
            {totalLabel || "Итого"} · {works.length}{" "}
            {plural(works.length, ["работа", "работы", "работ"])}
          </span>
          <span className="tw:ms-auto">{msToHMS(totalMinutes * 60000)}</span>
          {showCost && <span>{formatMoney(totalCost)}</span>}
        </div>
      </div>

      {footnote && (
        <div
          className={cn(
            "tw:border-t tw:px-4 tw:py-2.5 tw:text-sm",
            tone === "warning"
              ? "tw:border-warning/30 tw:bg-warning/10 tw:text-foreground"
              : "tw:border-border-soft tw:text-muted-foreground",
          )}
        >
          {footnote}
        </div>
      )}
    </div>
  );
};

export default ReportWorksTable;
