import { type ReactNode } from "react";
import { Link } from "react-router";

import AlertMessage from "@/components/app/AlertMessage";
import { Eyebrow } from "@/components/app/Panel";
import StatTile, { StatTileDelta } from "@/components/app/StatTile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { EmployeesSummaryResponse } from "../../types/employeesReport";

import ApprovalPanel from "./ApprovalPanel";
import EmployeesCards from "./EmployeesCards";
import EmployeesTable from "./EmployeesTable";
import { deltaOf } from "./delta";
import { formatMinutes, formatMoney } from "./work-format";

// Режим «Переработки»: норма, Δ, переработки и доплата. Это прежний главный
// экран отчёта — он никуда не делся, но перестал быть единственным.

const HINT = "к прошлому периоду";

const Panel = ({ children }: { children: ReactNode }) => (
  <section className="rounded-xl border border-border bg-card p-5">
    {children}
  </section>
);

const EmployeesOvertimeSegment = ({
  data,
  busy,
  currentUserId,
}: {
  data: EmployeesSummaryResponse;
  busy: boolean;
  currentUserId?: string;
}) => {
  const { totals, prev } = data;

  const missing = data.employees.filter(
    (row) => row.payroll.missingRate && row.overtime.roundedMinutes > 0,
  );
  const missingMinutes = missing.reduce(
    (sum, row) => sum + row.overtime.roundedMinutes,
    0,
  );
  const withOvertime = data.employees.filter(
    (row) => row.overtime.roundedMinutes > 0,
  );
  const overtimeWorks = data.employees.reduce(
    (sum, row) => sum + row.overtime.worksCount,
    0,
  );

  return (
    <div className={cn("transition-opacity", busy && "opacity-60")}>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
        <StatTile
          label="Переработки"
          busy={busy}
          value={formatMinutes(totals.overtime.roundedMinutes)}
          delta={
            <StatTileDelta
              {...deltaOf(
                totals.overtime.roundedMinutes,
                prev.totals.overtime.roundedMinutes,
              )}
              hint={HINT}
            />
          }
          footer={`Будни ${formatMinutes(totals.overtime.weekdayMinutes)} · Выходные ${formatMinutes(totals.overtime.weekendMinutes)}`}
        />
        <StatTile
          label="К доплате"
          busy={busy}
          value={formatMoney(totals.overtimePaySum)}
          delta={
            <StatTileDelta
              {...deltaOf(totals.overtimePaySum, prev.totals.overtimePaySum)}
              hint={HINT}
            />
          }
          footer={`по ставкам сотрудников ×${data.settings.weekdayCoefficient} будни / ×${data.settings.weekendCoefficient} выходные`}
        />
        <StatTile
          label="С переработками"
          busy={busy}
          value={`${withOvertime.length} из ${totals.employeesCount}`}
          footer={
            withOvertime.length > 0
              ? `${formatMinutes(Math.round(totals.overtime.roundedMinutes / withOvertime.length))} в среднем на человека`
              : "переработок за период нет"
          }
        />
        <StatTile
          label="Работ вне графика"
          busy={busy}
          value={overtimeWorks}
          footer={`из ${totals.worksCount} работ периода`}
        />
      </div>

      {missing.length > 0 && (
        <AlertMessage
          variant="warning"
          message={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                <b className="font-semibold">
                  {missing.length === 1
                    ? "У сотрудника не задана ставка переработок"
                    : `У ${missing.length} сотрудников не задана ставка переработок`}
                </b>
                <br />
                <span className="text-muted-foreground tabular-nums">
                  {missing
                    .map(
                      (row) =>
                        `${row.employee.lastName} ${row.employee.firstName} (${formatMinutes(row.overtime.roundedMinutes)})`,
                    )
                    .join(", ")}{" "}
                  — {formatMinutes(missingMinutes)} переработок не попали в
                  доплату. Ставка задаётся в карточке сотрудника.
                </span>
              </span>
              <Button asChild variant="outline" size="xs" className="ms-auto">
                <Link to="/users">Открыть пользователей</Link>
              </Button>
            </span>
          }
        />
      )}

      <Eyebrow
        count={totals.employeesCount}
        action={
          <span className="text-sm font-normal text-faint">
            строка ведёт в отчёт сотрудника
          </span>
        }
      >
        Переработки за период
      </Eyebrow>
      <div className="rounded-xl border border-border bg-card">
        <div className="hidden overflow-x-auto px-2 py-1.5 md:block">
          <EmployeesTable
            variant="overtime"
            employees={data.employees}
            totals={totals}
            currentUserId={currentUserId}
          />
        </div>
        <div className="md:hidden">
          <EmployeesCards
            variant="overtime"
            employees={data.employees}
            currentUserId={currentUserId}
          />
        </div>
      </div>

      <Eyebrow>Согласование работ</Eyebrow>
      <Panel>
        <ApprovalPanel
          byStatus={data.byStatus}
          note="Утверждённые работы вошли в отчёт по услугам — согласованы с клиентом и в биллинге больше не меняются. Учитывать только их можно переключателем в фильтре."
        />
      </Panel>
    </div>
  );
};

export default EmployeesOvertimeSegment;
