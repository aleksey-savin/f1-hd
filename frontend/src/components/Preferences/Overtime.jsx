import { useState } from "react";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Alert from "react-bootstrap/Alert";

import Schedule from "../../UI/Schedule";

const DEFAULT_OVERTIME = {
  defaultSchedule: {
    Monday: { isWorking: true, is24hours: false, start: "09:00", end: "18:00" },
    Tuesday: { isWorking: true, is24hours: false, start: "09:00", end: "18:00" },
    Wednesday: {
      isWorking: true,
      is24hours: false,
      start: "09:00",
      end: "18:00",
    },
    Thursday: {
      isWorking: true,
      is24hours: false,
      start: "09:00",
      end: "18:00",
    },
    Friday: { isWorking: true, is24hours: false, start: "09:00", end: "18:00" },
    Saturday: {
      isWorking: false,
      is24hours: false,
      start: "09:00",
      end: "18:00",
    },
    Sunday: { isWorking: false, is24hours: false, start: "09:00", end: "18:00" },
  },
  defaultTariffingPeriodMinutes: 15,
  weekdayCoefficient: 1,
  weekendCoefficient: 1,
};

const TARIFFING_PERIODS = [5, 10, 15, 20, 30, 60];

const PrefsOvertime = ({ prefs }) => {
  if (!prefs.overtime) {
    prefs.overtime = structuredClone(DEFAULT_OVERTIME);
  }
  if (!prefs.overtime.defaultSchedule?.Monday) {
    prefs.overtime.defaultSchedule = structuredClone(
      DEFAULT_OVERTIME.defaultSchedule,
    );
  }
  const { overtime } = prefs;

  const [tariffingPeriod, setTariffingPeriod] = useState(
    overtime.defaultTariffingPeriodMinutes ?? 15,
  );
  const [weekdayCoefficient, setWeekdayCoefficient] = useState(
    overtime.weekdayCoefficient ?? 1,
  );
  const [weekendCoefficient, setWeekendCoefficient] = useState(
    overtime.weekendCoefficient ?? 1,
  );

  const tariffingPeriodChangeHandler = (event) => {
    setTariffingPeriod(event.target.value);
    overtime.defaultTariffingPeriodMinutes = Number(event.target.value);
  };

  const weekdayCoefficientChangeHandler = (event) => {
    setWeekdayCoefficient(event.target.value);
    overtime.weekdayCoefficient = Number(event.target.value) || 1;
  };

  const weekendCoefficientChangeHandler = (event) => {
    setWeekendCoefficient(event.target.value);
    overtime.weekendCoefficient = Number(event.target.value) || 1;
  };

  return (
    <>
      <Alert variant="secondary">
        Переработки в персональном отчёте считаются так же, как в сводном
        финансовом отчёте: для работ по тарифу график и период тарификации
        берутся из тарифа или компании. Резервные значения ниже применяются к
        работам вне тарифов.
      </Alert>

      <h5>Резервный график работы</h5>
      <Form.Text muted>
        Время работ вне графика и в нерабочие дни считается переработкой.
      </Form.Text>
      <Schedule
        existingSchedule={overtime.defaultSchedule}
        onChange={(schedule) => {
          overtime.defaultSchedule = schedule;
        }}
      />

      <Form.Group className="mt-3 mb-3" as={Row}>
        <Col sm={6} lg={4}>
          <Form.Label>Резервный период тарификации</Form.Label>
          <Form.Select
            value={tariffingPeriod}
            onChange={tariffingPeriodChangeHandler}
          >
            {TARIFFING_PERIODS.map((period) => (
              <option key={period} value={period}>
                {period} мин
              </option>
            ))}
          </Form.Select>
          <Form.Text muted>
            Переработка за день округляется вверх до этого шага.
          </Form.Text>
        </Col>
      </Form.Group>

      <h5 className="mt-4">Оплата переработок</h5>
      <Form.Text muted>
        Доплата = часы переработки × ставка сотрудника × коэффициент. На
        величину переработки коэффициенты не влияют.
      </Form.Text>
      <Form.Group className="mt-2 mb-3" as={Row}>
        <Col sm={6} lg={4}>
          <Form.Label>Коэффициент в будни</Form.Label>
          <Form.Control
            type="number"
            min="0"
            step="0.1"
            value={weekdayCoefficient}
            onChange={weekdayCoefficientChangeHandler}
          />
        </Col>
        <Col sm={6} lg={4}>
          <Form.Label>Коэффициент в выходные</Form.Label>
          <Form.Control
            type="number"
            min="0"
            step="0.1"
            value={weekendCoefficient}
            onChange={weekendCoefficientChangeHandler}
          />
        </Col>
      </Form.Group>
    </>
  );
};

export default PrefsOvertime;
