import { Fragment, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";

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

import type { EmployeeRow, EmployeesTotals } from "../../types/employeesReport";

import ShareBars from "./ShareBars";
import { useExpanded } from "./table-kit";
import { formatMinutes, formatMoney, fullName, initials } from "./work-format";

// Таблица сводки по сотрудникам. Один компонент на два режима отчёта —
// «Статистика» (выработка) и «Переработки» (норма, Δ, доплата): данные те же,
// меняется набор колонок, поэтому таблица не форкается, а получает variant.
// Строка ведёт в отчёт сотрудника, своя помечена «Вы»; сотрудники без работ
// свёрнуты — они не должны отодвигать данные.
//
// canSeeMoney — право `user.manageFinances`: без него колонки «К доплате»
// просто нет (сервер и сумм не присылает), а не стоит пустой с прочерками.

type EmployeesTableVariant = "stats" | "overtime";

type SortKey =
  | "name"
  | "worksCount"
  | "ticketsFinished"
  | "totalMinutes"
  | "utilization"
  | "overtime"
  | "pay";

const EmployeesTable = ({
  employees,
  totals,
  currentUserId,
  variant = "stats",
  canSeeMoney = false,
}: {
  employees: EmployeeRow[];
  totals: EmployeesTotals;
  currentUserId?: string;
  variant?: EmployeesTableVariant;
  canSeeMoney?: boolean;
}) => {
  // Колонка «К доплате» живёт только в «Переработках» и только с правом
  const showPay = variant === "overtime" && canSeeMoney;
  const columnsCount = variant === "stats" ? 7 : showPay ? 8 : 7;
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "totalMinutes",
    desc: true,
  });
  const [showIdle, setShowIdle] = useState(false);
  const { expanded, toggle } = useExpanded();

  const valueOf = (row: EmployeeRow, key: SortKey): number | string => {
    if (key === "name") return fullName(row.employee);
    if (key === "overtime") return row.overtime.roundedMinutes;
    if (key === "pay") return row.payroll.overtimePay ?? -1;
    if (key === "utilization") return row.utilizationPercent ?? -1;
    return row[key];
  };

  const sorted = [...employees].sort((a, b) => {
    const left = valueOf(a, sort.key);
    const right = valueOf(b, sort.key);
    const compared =
      typeof left === "string" || typeof right === "string"
        ? String(left).localeCompare(String(right), "ru")
        : left - right;
    return sort.desc ? -compared : compared;
  });

  // Свою строку показываем всегда — даже без работ за период
  const active = sorted.filter(
    (row) => row.worksCount > 0 || row.employee._id === currentUserId,
  );
  const idle = sorted.filter(
    (row) => row.worksCount === 0 && row.employee._id !== currentUserId,
  );
  const rows = showIdle ? [...active, ...idle] : active;

  const Th = ({
    columnKey,
    children,
    numeric = true,
  }: {
    columnKey: SortKey;
    children: ReactNode;
    numeric?: boolean;
  }) => {
    const isActive = sort.key === columnKey;
    return (
      <TableHead className={cn("whitespace-nowrap", numeric && "text-right")}>
        <button
          type="button"
          onClick={() =>
            setSort({ key: columnKey, desc: isActive ? !sort.desc : true })
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
              className={cn("transition-transform", !sort.desc && "rotate-180")}
            />
          )}
        </button>
      </TableHead>
    );
  };

  const personCell = (row: EmployeeRow) => {
    const isMe = row.employee._id === currentUserId;
    const canExpand = variant === "stats" && (row.byCompany?.length ?? 0) > 0;
    return (
      <TableCell>
        <span className="flex items-center gap-1.5">
          {canExpand ? (
            <button
              type="button"
              aria-label={
                expanded.has(row.employee._id)
                  ? "Свернуть компании сотрудника"
                  : "Показать компании сотрудника"
              }
              aria-expanded={expanded.has(row.employee._id)}
              onClick={(event) => {
                event.stopPropagation();
                toggle(row.employee._id);
              }}
              className="grid size-5 flex-none cursor-pointer place-items-center appearance-none rounded border-0 bg-transparent p-0 text-faint outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50"
            >
              <RiArrowRightSLine
                size={15}
                aria-hidden
                className={cn(
                  "transition-transform",
                  expanded.has(row.employee._id) && "rotate-90",
                )}
              />
            </button>
          ) : (
            <span className="size-5 flex-none" />
          )}
          <span className="grid size-8 flex-none place-items-center rounded-[25%] bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border">
            {initials(row.employee)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-medium">
              <span className="truncate">{fullName(row.employee)}</span>
              {isMe && (
                <span className="flex-none rounded-full bg-primary px-2 py-px text-xs font-semibold text-white">
                  Вы
                </span>
              )}
              {!row.employee.isActive && (
                <span className="flex-none text-xs text-faint">уволен</span>
              )}
            </span>
            <span className="block truncate text-xs text-faint">
              {row.employee.position || "Должность не указана"}
            </span>
          </span>
        </span>
      </TableCell>
    );
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <Th columnKey="name" numeric={false}>
            Сотрудник
          </Th>
          {variant === "stats" ? (
            <>
              <Th columnKey="worksCount">Работы</Th>
              <Th columnKey="ticketsFinished">Заявки</Th>
              <TableHead
                className="text-right whitespace-nowrap"
                title="Выезды / удалённые / регламентные"
              >
                Выезд · удал. · регл.
              </TableHead>
              <Th columnKey="totalMinutes">Отработано</Th>
              <Th columnKey="utilization">Загрузка</Th>
            </>
          ) : (
            <>
              <Th columnKey="totalMinutes">Отработано</Th>
              <TableHead
                className="text-right whitespace-nowrap"
                title="Норма по производственному календарю и личному графику, минус подтверждённые отсутствия"
              >
                Норма
              </TableHead>
              <TableHead className="text-right whitespace-nowrap">Δ</TableHead>
              <Th columnKey="overtime">Переработки</Th>
              <TableHead className="text-right whitespace-nowrap">
                Будни / выходные
              </TableHead>
              {showPay && <Th columnKey="pay">К доплате</Th>}
            </>
          )}
          <TableHead className="w-6" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const isMe = row.employee._id === currentUserId;
          const overtime = row.overtime.roundedMinutes;
          const utilization = row.utilizationPercent;
          return (
            <Fragment key={row.employee._id}>
              <TableRow
                onClick={() =>
                  navigate(`/finances/employees/${row.employee._id}`)
                }
                className={cn(
                  "cursor-pointer",
                  isMe && "bg-primary/7 hover:bg-primary/12",
                )}
              >
                {personCell(row)}

                {variant === "stats" ? (
                  <>
                    <TableCell className="text-right tabular-nums">
                      {row.worksCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.ticketsFinished}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
                      {[
                        row.onSite.count,
                        row.remote.count,
                        row.routineTask.count,
                      ]
                        .map((count) => (count === 0 ? "—" : count))
                        .join(" · ")}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMinutes(row.totalMinutes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {utilization === null ? (
                        <span
                          className="text-xs text-warning"
                          title="Личный график не задан — сравнивать не с чем"
                        >
                          нет графика
                        </span>
                      ) : (
                        <span
                          className={cn(
                            utilization >= 90 &&
                              "font-semibold text-accent-text",
                            utilization < 60 && "text-faint",
                          )}
                          title={`Отработано к норме ${formatMinutes(row.normMinutes)}`}
                        >
                          {utilization}%
                        </span>
                      )}
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMinutes(row.totalMinutes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.hasPersonalSchedule ? (
                        <span
                          title={`${row.workingDays} рабочих дней · пояс ${row.timezone}`}
                        >
                          {formatMinutes(row.normMinutes)}
                        </span>
                      ) : (
                        <span
                          className="text-xs text-warning"
                          title="Переработки считаются по окну обслуживания клиента, как до появления графиков"
                        >
                          нет графика
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.hasPersonalSchedule ? (
                        <span
                          className={cn(
                            row.totalMinutes - row.normMinutes >= 0
                              ? "font-semibold text-accent-text"
                              : "text-muted-foreground",
                          )}
                        >
                          {row.totalMinutes - row.normMinutes > 0 ? "+" : ""}
                          {formatMinutes(row.totalMinutes - row.normMinutes)}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        overtime === 0 && "text-faint",
                      )}
                    >
                      {formatMinutes(overtime)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap text-faint tabular-nums">
                      {overtime === 0
                        ? "—"
                        : `${formatMinutes(row.overtime.weekdayMinutes)} / ${formatMinutes(row.overtime.weekendMinutes)}`}
                    </TableCell>
                    {showPay && (
                      <TableCell className="text-right tabular-nums">
                        {row.payroll.missingRate && overtime > 0 ? (
                          <span className="text-warning">нет ставки</span>
                        ) : row.payroll.overtimePay ? (
                          <b className="font-semibold">
                            {formatMoney(row.payroll.overtimePay)}
                          </b>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </TableCell>
                    )}
                  </>
                )}

                <TableCell className="text-faint">
                  <RiArrowRightSLine size={16} aria-hidden />
                </TableCell>
              </TableRow>

              {variant === "stats" && expanded.has(row.employee._id) && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columnsCount} className="py-3 ps-12">
                    <div className="mb-2 text-xs tracking-wide text-faint uppercase">
                      Компании сотрудника за период
                    </div>
                    <ShareBars
                      collapseAfter={5}
                      rows={(row.byCompany ?? []).map((company) => ({
                        key: company._id ?? "none",
                        label: company.alias,
                        value: company.minutes,
                      }))}
                    />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}

        {idle.length > 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columnsCount} className="py-2">
              <button
                type="button"
                onClick={() => setShowIdle((current) => !current)}
                className="inline-flex cursor-pointer appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50"
              >
                <RiArrowRightSLine
                  size={15}
                  aria-hidden
                  className={cn(
                    "transition-transform",
                    showIdle && "rotate-90",
                  )}
                />
                {showIdle
                  ? "Скрыть сотрудников без работ"
                  : `Ещё ${idle.length} без работ за период`}
              </button>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Итого</TableCell>
          {variant === "stats" ? (
            <>
              <TableCell className="text-right tabular-nums">
                {totals.worksCount}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {totals.ticketsFinished}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
                {[
                  totals.onSite.count,
                  totals.remote.count,
                  totals.routineTask.count,
                ].join(" · ")}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatMinutes(totals.totalMinutes)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {totals.normMinutes > 0
                  ? `${Math.round((totals.totalMinutes / totals.normMinutes) * 100)}%`
                  : "—"}
              </TableCell>
            </>
          ) : (
            <>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatMinutes(totals.totalMinutes)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMinutes(totals.normMinutes)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {/* Δ по итогу считаем от нормы: у кого графика нет, норма нулевая
                    и в сумму не входит — сноска о них живёт под таблицей */}
                {formatMinutes(totals.totalMinutes - totals.normMinutes)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMinutes(totals.overtime.roundedMinutes)}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap text-faint tabular-nums">
                {formatMinutes(totals.overtime.weekdayMinutes)} /{" "}
                {formatMinutes(totals.overtime.weekendMinutes)}
              </TableCell>
              {showPay && (
                <TableCell className="text-right tabular-nums">
                  {formatMoney(totals.overtimePaySum ?? 0)}
                </TableCell>
              )}
            </>
          )}
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
};

export default EmployeesTable;
