import { useEffect, useState, useContext } from "react";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Alert from "react-bootstrap/Alert";

import {
  calcSingleWorkOvertime,
  formatOvertimeMinutes,
  calculateCost,
} from "../../util/finances";

import { formatPrice } from "../../util/format-string";

import { useLoaderData } from "react-router";

import { AuthedUserContext } from "../../store/authed-user-context";

const CheckIfWithinPlan = ({ work, startedAt, finishedAt }) => {
  const {
    hasServicePlan,
    schedule,
    pricePerHourNonWorking = 0,
    tariffingPeriod = 0,
    alwaysWithinPlan = false,
  } = useLoaderData();

  const { permissions } = useContext(AuthedUserContext);
  const { canUseFinancesModule, canSeeGlobalFinancialReport } = permissions;

  const [withinPlan, setWithinPlan] = useState(
    work?.withinPlan || alwaysWithinPlan || false,
  );
  const [outOfSchedule, setOutOfSchedule] = useState({
    actualOvertime: 0,
    roundUpOvertime: 0,
  });
  const [cost, setCost] = useState("");

  const withinPlanHandler = () => {
    setWithinPlan(!withinPlan);
  };

  useEffect(() => {
    const overtime = calcSingleWorkOvertime(
      schedule,
      { startedAt: startedAt, finishedAt: finishedAt },
      tariffingPeriod,
    );
    setOutOfSchedule(overtime);
    setCost(
      calculateCost(
        overtime.roundUpOvertime / (1000 * 60),
        pricePerHourNonWorking,
        tariffingPeriod,
      ),
    );
  }, [startedAt, finishedAt]);

  return (
    <>
      {outOfSchedule.actualOvertime > 0 &&
        hasServicePlan &&
        !alwaysWithinPlan && (
          <Alert variant="warning">
            <Row className="mb-3">
              <Col>
                <strong>{`Указанное время работ выходит за рамки графика оказания услуг на ${formatOvertimeMinutes(outOfSchedule.actualOvertime / (1000 * 60))} и будет тарифицироваться отдельно.`}</strong>
              </Col>
            </Row>
            <Row className="mb-3">
              <Col>
                <Form.Group>
                  <Form.Check
                    type="switch"
                    checked={withinPlan}
                    value={withinPlan}
                    onChange={withinPlanHandler}
                    label="Учесть работы как выполненные в рабочее время"
                    id="withinPlan"
                    name="withinPlan"
                  />
                </Form.Group>
              </Col>
            </Row>
            {canUseFinancesModule && canSeeGlobalFinancialReport && (
              <Row>
                <Col>
                  <strong>{`Предварительная стоимость работ: ${withinPlan ? formatPrice(0) : cost}`}</strong>
                </Col>
              </Row>
            )}
          </Alert>
        )}
      {alwaysWithinPlan && hasServicePlan && (
        <Alert variant="success">
          <Row>
            <Col>
              <strong>{`Данная категория заявки всегда входит в график оказания услуг и будет тарифицироваться в рамках плана.`}</strong>
            </Col>
          </Row>
        </Alert>
      )}
    </>
  );
};

export default CheckIfWithinPlan;
