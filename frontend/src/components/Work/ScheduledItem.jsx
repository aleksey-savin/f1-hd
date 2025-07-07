import { useState, useContext } from "react";
import { NavLink, useLoaderData } from "react-router";

import { formatDateTime } from "../../util/format-date";
import { msToHMS } from "../../util/time-helpers";

import { AddToCalendar } from "./AddToCalendar";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Image from "react-bootstrap/Image";

import { AuthedUserContext } from "../../store/authed-user-context";

import useViewTicketStore from "../../store/viewTicket";
import Button from "react-bootstrap/esm/Button";
import { GiConfirmed } from "react-icons/gi";
import { RiEdit2Line } from "react-icons/ri";
import { isBrowser } from "react-device-detect";
import DeleteWork from "./Delete";
import { calcSingleWorkOvertime, calculateCost } from "../../util/finances";
import { Badge } from "react-bootstrap";

function ScheduledWorkItem({ work }) {
  const { isAdmin, _id: userId, permissions } = useContext(AuthedUserContext);

  const { ticket } = useViewTicketStore();

  const [isNew, setIsNew] = useState(
    new Date() - new Date(work.createdAt) < 10000 ? true : false,
  );

  const isOverdue = new Date(work.planningToStart) < new Date();

  const bgClassName = isNew
    ? "bg-success bg-opacity-10"
    : isOverdue
      ? "bg-danger bg-opacity-10"
      : "bg-warning bg-opacity-10";

  setTimeout(() => {
    setIsNew(false);
  }, 15000);

  const {
    ticketData,
    hasServicePlan,
    schedule,
    pricePerHourNonWorking = 0,
    tariffingPeriod = 0,
  } = useLoaderData();

  let overtime = {};
  let outOfSchedule = {};

  if (hasServicePlan && !ticketData.ticket.category?.alwaysWithinPlan) {
    overtime = calcSingleWorkOvertime(
      schedule,
      { startedAt: work.planningToStart, finishedAt: work.planningToFinish },
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

  return (
    <>
      <Card className={`shadow-sm mb-3 ${bgClassName}`}>
        <Card.Body>
          <Row className="mb-2">
            <Col>
              <Image
                src={
                  work.executor.profileImagePath
                    ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${work.executor.profileImagePath}`
                    : "/profilepic-placeholder.jpg"
                }
                style={{ maxHeight: "30px" }}
                className="me-2"
                roundedCircle
              />
              <strong>{`${work?.executor?.lastName} ${work?.executor?.firstName}`}</strong>
            </Col>
            <Col className="text-end ">
              {((work.withinPlan || !outOfSchedule.isOutOfSchedule) && (
                <Badge bg="primary">В рамках тарифа</Badge>
              )) || <Badge bg="warning">Доп. оплата</Badge>}
            </Col>
          </Row>
          <Row className="mb-2">
            <Col>
              {!work.visitRequired
                ? "Запланированы удалённые работы "
                : "Запланирован выезд "}
              на <strong>{formatDateTime(work.planningToStart)}</strong>
            </Col>
          </Row>
          <Row className="mb-2">
            <Col>
              Предварительная длительность{" "}
              <strong>
                {msToHMS(
                  new Date(work.planningToFinish) -
                    new Date(work.planningToStart),
                )}
              </strong>
            </Col>
          </Row>
          {outOfSchedule.isOutOfSchedule &&
            !work.withinPlan &&
            permissions.canManageServicePlans && (
              <Row className="mb-2">
                <Col className="text-warning my-auto">{`Предварительная стоимость ${outOfSchedule.cost}`}</Col>
              </Row>
            )}
          <Row className="justify-content-end align-items-end">
            <Col className="mb-3">
              <AddToCalendar
                ticket={ticket}
                start={work.planningToStart}
                finish={work.planningToFinish}
              />
            </Col>
            <Col xs="auto" className="text-end">
              <Row>
                {(isAdmin ||
                  work.createdBy?._id.toString() === userId.toString()) && (
                  <>
                    <Col xs="auto">
                      <Button
                        as={NavLink}
                        to={`work-scheduled/${work._id.toString()}/update`}
                        className=""
                      >
                        <RiEdit2Line /> Изменить
                      </Button>
                    </Col>
                    {isBrowser && (
                      <Col xs="auto" className="text-end">
                        <DeleteWork work={work} />
                      </Col>
                    )}
                  </>
                )}
                {(isAdmin ||
                  work.executor?._id.toString() === userId.toString()) && (
                  <Col xs="auto">
                    <Button
                      as={NavLink}
                      to={`work/${work._id.toString()}/confirm`}
                    >
                      <GiConfirmed /> Подтвердить
                    </Button>
                  </Col>
                )}
              </Row>
            </Col>
          </Row>
        </Card.Body>
      </Card>
    </>
  );
}

export default ScheduledWorkItem;
