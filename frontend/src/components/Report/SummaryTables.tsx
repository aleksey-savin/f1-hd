import { useState } from "react";
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
import { monogramFor } from "@/components/app/monogram";

import type { CompanyRow, ReportTotals } from "../../types/report";
import { msToHMS } from "../../util/time-helpers";

import {
  CountTimeCell,
  SortableHead,
  sortRows,
  type SortState,
} from "./table-kit";

// Таблица сводки по компаниям. Строка ведёт в карточку компании: раньше она
// раскрывалась в список исполнителей, но у компании появилась собственная
// страница — прятать её содержимое в аккордеон списка больше незачем.

type CompanySortKey =
  | "alias"
  | "totalTickets"
  | "totalWorks"
  | "onSite"
  | "remote"
  | "routineTask"
  | "totalTime";

const companyValue = (row: CompanyRow, key: CompanySortKey) => {
  if (key === "alias") return row.company.alias;
  if (key === "onSite" || key === "remote" || key === "routineTask")
    return row[key].time;
  return row[key];
};

export const CompanySummaryTable = ({
  companies,
  totals,
  onOpen,
}: {
  companies: CompanyRow[];
  totals: ReportTotals;
  onOpen: (companyId: string) => void;
}) => {
  const [sort, setSort] = useState<SortState<CompanySortKey>>({
    key: "totalTime",
    direction: "desc",
  });
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
          <TableHead className="tw:w-6" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.company._id}
            onClick={() => onOpen(row.company._id)}
            className="tw:cursor-pointer"
          >
            <TableCell>
              <span className="tw:flex tw:items-center tw:gap-2.5">
                <span
                  aria-hidden
                  className="tw:grid tw:size-8 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-[0.6875rem] tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
                >
                  {monogramFor(row.company.alias)}
                </span>
                <span className="tw:min-w-0">
                  <span className="tw:block tw:truncate tw:font-medium">
                    {row.company.alias}
                  </span>
                  {row.scopeLimited && (
                    <span className="tw:block tw:text-xs tw:text-faint">
                      данные вашего подразделения
                    </span>
                  )}
                </span>
              </span>
            </TableCell>
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
            <TableCell className="tw:text-faint">
              <RiArrowRightSLine size={16} aria-hidden />
            </TableCell>
          </TableRow>
        ))}
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
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
};
