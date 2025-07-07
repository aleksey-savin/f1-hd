import { useState, useContext } from "react";
import { NavLink, useLoaderData } from "react-router";

import { formatDate } from "../../util/format-date";
import { msToHMS } from "../../util/time-helpers";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Image from "react-bootstrap/Image";
import Badge from "react-bootstrap/Badge";

import { AuthedUserContext } from "../../store/authed-user-context";

import DeleteWork from "./Delete";
import { isBrowser } from "react-device-detect";

import Button from "react-bootstrap/Button";
import { calcSingleWorkOvertime, calculateCost } from "../../util/finances";

function WorkItem({ work, isArchived }) {
  const { isAdmin, _id: userId, permissions } = useContext(AuthedUserContext);

  const { canUseFinancesModule, canSeeGlobalFinancialReport } = permissions;

  const [isNew, setIsNew] = useState(
    new Date() - new Date(work.createdAt) < 10000 ? true : false,
  );

  setTimeout(() => {
    setIsNew(false);
  }, 15000);

  const {
    hasServicePlan,
    alwaysWithinPlan,
    schedule,
    pricePerHourNonWorking = 0,
    tariffingPeriod = 0,
    ticketData,
  } = useLoaderData();

  let overtime = {};
  let outOfSchedule = {};

  if (hasServicePlan && !ticketData.ticket.category?.alwaysWithinPlan) {
    overtime = calcSingleWorkOvertime(
      schedule,
      { startedAt: work.startedAt, finishedAt: work.finishedAt },
      tariffingPeriod,
    );
    outOfSchedule = {
      isOutOfSchedule: !!overtime.actualOvertime,
      actualOvertime: overtime.actualOvertime,
      roundUpOvertime: overtime.roundUpOvertime,
      cost: calculateCost(
        overtime.roundUpOvertime / (1000 * 60),
        pricePerHourNonWorking,
        tariffingPeriod,
      ),
    };
  }

  const isWithinPlan =
    work.withinPlan || alwaysWithinPlan || !outOfSchedule.isOutOfSchedule;

  return (
    <>
      <Card
        className={`shadow-sm mb-3 ${isNew ? "bg-success bg-opacity-10" : ""}`}
      >
        <Card.Body>
          <Row className="mb-2 justify-content-end align-items-top">
            <Col>
              <Image
                src={
                  work.finishedBy.profileImagePath
                    ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${work.finishedBy.profileImagePath}`
                    : "/profilepic-placeholder.jpg"
                }
                style={{ maxHeight: "30px" }}
                className="me-2"
                roundedCircle
              />
              <strong>{`${work?.finishedBy?.lastName} ${work?.finishedBy?.firstName}`}</strong>{" "}
              <span className="text-body-secondary">{`${formatDate(
                work.createdAt,
              )}`}</span>
            </Col>
            <Col className="text-end ">
              {(isWithinPlan && (
                <Badge bg="primary">В рамках тарифа</Badge>
              )) || <Badge bg="warning">Доп. оплата</Badge>}
            </Col>
          </Row>
          <Row className="mb-2">
            <Col>
              {work.visitRequired && (
                <span>
                  Произведён <strong>выезд</strong>.{" "}
                </span>
              )}
              {!work.visitRequired && (
                <span>
                  Проведены <strong>удалённые работы</strong>.{" "}
                </span>
              )}
              {work.description}
            </Col>
          </Row>
          <Row>
            <Col>
              Длительность{" "}
              <strong>
                {msToHMS(new Date(work.finishedAt) - new Date(work.startedAt))}
              </strong>
            </Col>
          </Row>
          <Row className="justify-content-end align-items-end">
            {!isWithinPlan &&
              canUseFinancesModule &&
              canSeeGlobalFinancialReport && (
                <Col className="text-warning my-auto mb-2">{`${isArchived ? "Стоимость" : "Предварительная стоимость"} ${outOfSchedule.cost}`}</Col>
              )}
            {!isArchived &&
              (isAdmin || work.createdBy?._id.toString() === userId) && (
                <>
                  {isBrowser && (
                    <Col xs="auto" className="text-end">
                      <DeleteWork work={work} />
                    </Col>
                  )}
                  <Col xs="auto" className="text-end">
                    <Button
                      as={NavLink}
                      to={`work/${work._id.toString()}/update`}
                    >
                      Изменить
                    </Button>
                  </Col>
                </>
              )}
          </Row>
        </Card.Body>
      </Card>
    </>
  );
}

export default WorkItem;
