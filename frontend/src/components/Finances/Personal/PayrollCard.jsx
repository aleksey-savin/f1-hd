import { Link } from "react-router";

import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Card from "react-bootstrap/Card";

import { RiWallet3Line } from "react-icons/ri";

import { formatPrice } from "../../../util/format-string";
import { formatMinutes } from "./format";

const formatCoefficient = (value) =>
  Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

const PayslipRow = ({ label, formula, amount, muted }) => (
  <div className="payslip__row">
    <div>
      <div className={muted ? "text-body-secondary" : ""}>{label}</div>
      {formula && <div className="payslip__formula">{formula}</div>}
    </div>
    <div className={`payslip__amount ${muted ? "text-body-secondary" : ""}`}>
      {amount}
    </div>
  </div>
);

const OvertimeRow = ({ label, bucket, rate }) => {
  if (!bucket || bucket.minutes === 0) {
    return (
      <PayslipRow label={label} amount={<span>—</span>} muted />
    );
  }
  return (
    <PayslipRow
      label={label}
      formula={
        rate != null
          ? `${formatMinutes(bucket.minutes)} × ${formatPrice(rate)}/ч × ${formatCoefficient(bucket.coefficient)}`
          : formatMinutes(bucket.minutes)
      }
      amount={bucket.pay != null ? formatPrice(bucket.pay) : "—"}
    />
  );
};

// «Расчётный листок» — это оценка для сотрудника, не бухгалтерский документ
const PayrollCard = ({ payroll, employee, canManageUsers }) => {
  const { missing } = payroll;
  const hasRate = payroll.overtimeHourlyRate != null;

  return (
    <Card className="h-100">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span>
          <RiWallet3Line /> Расчётный листок
        </span>
        <Badge bg="secondary">оценка</Badge>
      </Card.Header>
      <Card.Body className="payslip">
        {(missing.salary || missing.overtimeHourlyRate) && (
          <Alert variant="warning" className="py-2 small">
            {missing.salary && missing.overtimeHourlyRate
              ? "Оклад и ставка переработок не указаны."
              : missing.salary
                ? "Оклад не указан."
                : "Ставка переработок не указана."}{" "}
            {canManageUsers ? (
              <Alert.Link
                as={Link}
                to={`/users/update/${employee._id}`}
              >
                Указать в карточке сотрудника
              </Alert.Link>
            ) : (
              "Обратитесь к администратору."
            )}
          </Alert>
        )}

        <PayslipRow
          label="Оклад"
          amount={
            payroll.salary != null
              ? `${formatPrice(payroll.salary)}/мес`
              : "не задан"
          }
          muted={payroll.salary == null}
        />
        <PayslipRow
          label="Ставка переработок"
          amount={
            hasRate ? `${formatPrice(payroll.overtimeHourlyRate)}/ч` : "не задана"
          }
          muted={!hasRate}
        />

        <OvertimeRow
          label="Переработки в будни"
          bucket={payroll.weekday}
          rate={payroll.overtimeHourlyRate}
        />
        <OvertimeRow
          label="Переработки в выходные"
          bucket={payroll.weekend}
          rate={payroll.overtimeHourlyRate}
        />

        <div className="payslip__row payslip__total">
          <div>Доплата за переработки</div>
          <div className="payslip__amount">
            {payroll.overtimePay != null ? formatPrice(payroll.overtimePay) : "—"}
          </div>
        </div>

        {payroll.estimatedTotal != null ? (
          <div className="payslip__row payslip__grand">
            <div>Итого за месяц</div>
            <div className="payslip__amount">
              {formatPrice(payroll.estimatedTotal)}
            </div>
          </div>
        ) : (
          payroll.salary != null && (
            <div className="payslip__formula mt-2">
              Итог с окладом рассчитывается для полного календарного месяца.
            </div>
          )
        )}
      </Card.Body>
    </Card>
  );
};

export default PayrollCard;
