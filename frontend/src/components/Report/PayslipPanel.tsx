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
      "tw:grid tw:grid-cols-[1fr_auto] tw:items-baseline tw:gap-x-4 tw:gap-y-0.5 tw:border-t tw:border-border-soft tw:py-2.5 tw:first:border-t-0 tw:sm:grid-cols-[1fr_auto_8rem]",
      total &&
        "tw:mt-1 tw:border-t tw:border-border tw:pt-3 tw:font-semibold",
    )}
  >
    <span>{label}</span>
    <span className="tw:text-xs tw:text-faint tw:tabular-nums tw:max-sm:col-span-2">
      {formula}
    </span>
    <span
      className={cn(
        "tw:text-right tw:font-medium tw:tabular-nums",
        total && "tw:text-lg",
      )}
    >
      {amount}
    </span>
  </div>
);

const PayslipPanel = ({ payroll }: { payroll: PersonalPayroll }) => {
  const rate = payroll.overtimeHourlyRate;

  return (
    <>
      <div className="tw:flex tw:flex-col">
        <Row
          label="Оклад"
          formula={payroll.isFullMonth ? "полный месяц" : "период не месяц"}
          amount={
            payroll.salary == null ? (
              <span className="tw:font-normal tw:text-faint">не указан</span>
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
              <span className="tw:font-normal tw:text-warning">нет ставки</span>
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
              <span className="tw:font-normal tw:text-warning">нет ставки</span>
            ) : (
              formatMoney(payroll.weekend.pay)
            )
          }
        />
        <Row
          total
          label={payroll.estimatedTotal == null ? "Доплата за период" : "Итого за месяц"}
          formula={
            payroll.estimatedTotal == null
              ? "оклад считается только за полный месяц"
              : `оклад + доплата ${formatMoney(payroll.overtimePay)}`
          }
          amount={formatMoney(payroll.estimatedTotal ?? payroll.overtimePay)}
        />
      </div>
      <p className="tw:mt-3.5 tw:mb-0 tw:text-xs tw:text-faint">
        Переработка — время работ вне графика тарифа или компании, округлённое
        вверх до периода тарификации. Коэффициенты заданы в настройках системы.
      </p>
    </>
  );
};

export default PayslipPanel;
