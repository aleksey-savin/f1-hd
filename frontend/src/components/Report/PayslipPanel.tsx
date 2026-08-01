import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { PersonalPayroll } from "../../types/employeesReport";

import { formatMinutes, formatMoney } from "./work-format";

// Расчёт за месяц: оклад, доплата за переработки по индивидуальной ставке и
// коэффициентам, итог. Формулы показаны рядом со значениями — расчёт должен
// быть проверяемым, а не «числом из воздуха».
const Row = ({
  label,
  formula,
  amount,
  total = false,
}: {
  label: ReactNode;
  formula?: ReactNode;
  amount: ReactNode;
  total?: boolean;
}) => (
  <div
    className={cn(
      "grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 border-t border-border-soft py-2.5 first:border-t-0 sm:grid-cols-[1fr_auto_8rem]",
      total && "mt-1 border-t border-border pt-3 font-semibold",
    )}
  >
    <span>{label}</span>
    <span className="text-xs text-faint tabular-nums max-sm:col-span-2">
      {formula}
    </span>
    <span
      className={cn("text-right font-medium tabular-nums", total && "text-lg")}
    >
      {amount}
    </span>
  </div>
);

const PayslipPanel = ({ payroll }: { payroll: PersonalPayroll }) => {
  const rate = payroll.overtimeHourlyRate;

  return (
    <>
      <div className="flex flex-col">
        <Row
          label="Оклад"
          formula={payroll.isFullMonth ? "полный месяц" : "период не месяц"}
          amount={
            payroll.salary == null ? (
              <span className="font-normal text-faint">не указан</span>
            ) : (
              formatMoney(payroll.salary)
            )
          }
        />
        <Row
          label="Переработки в будни"
          formula={
            rate == null
              ? formatMinutes(payroll.weekday.minutes)
              : `${formatMinutes(payroll.weekday.minutes)} × ${rate.toLocaleString("ru-RU")} ₽ × ${payroll.weekday.coefficient}`
          }
          amount={
            rate == null ? (
              <span className="font-normal text-warning">нет ставки</span>
            ) : (
              formatMoney(payroll.weekday.pay)
            )
          }
        />
        <Row
          label="Переработки в выходные"
          formula={
            rate == null
              ? formatMinutes(payroll.weekend.minutes)
              : `${formatMinutes(payroll.weekend.minutes)} × ${rate.toLocaleString("ru-RU")} ₽ × ${payroll.weekend.coefficient}`
          }
          amount={
            rate == null ? (
              <span className="font-normal text-warning">нет ставки</span>
            ) : (
              formatMoney(payroll.weekend.pay)
            )
          }
        />
        <Row
          total
          label={
            payroll.estimatedTotal == null
              ? "Доплата за период"
              : "Итого за месяц"
          }
          formula={
            payroll.estimatedTotal == null
              ? "оклад считается только за полный месяц"
              : `оклад + доплата ${formatMoney(payroll.overtimePay)}`
          }
          amount={formatMoney(payroll.estimatedTotal ?? payroll.overtimePay)}
        />
      </div>
      <p className="mt-3.5 mb-0 text-xs text-faint">
        Переработка — время работ вне графика тарифа или компании, округлённое
        вверх до периода тарификации. Коэффициенты заданы в настройках системы.
      </p>
    </>
  );
};

export default PayslipPanel;
