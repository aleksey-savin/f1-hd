import { useState, useContext } from "react";

import { formatDateTime } from "../../util/format-date";
import { msToHMS } from "../../util/time-helpers";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";

import UpdateScheduledWork from "./UpdateScheduled";
import ConfirmScheduledWork from "./ConfirmScheduled";

import { AuthedUserContext } from "../../store/authed-user-context";

function ScheduledWorkItemDashboard({ work, ticket, works, setWorks }) {
  const { isAdmin, _id: userId } = useContext(AuthedUserContext);

  const [isNew, setIsNew] = useState(
    new Date() - new Date(work.createdAt) < 10000 ? true : false,
  );

  setTimeout(() => {
    setIsNew(false);
  }, 15000);

  return (
    <>
      <Card
        className={`shadow-sm mb-3 ${
          isNew ? "bg-success bg-opacity-10" : "bg-warning bg-opacity-10"
        }`}
      >
        <Card.Body>
          <Row className="mb-2">
            <Col>
              <strong>{`${work?.executor?.lastName} ${work?.executor?.firstName}`}</strong>{" "}
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
          <Row className="justify-content-end align-items-end">
            <Col xs="auto" className="text-end">
              <Row>
                {(isAdmin ||
                  work.createdBy?._id.toString() === userId.toString()) && (
                  <Col xs="auto">
                    <UpdateScheduledWork
                      work={work}
                      ticket={ticket}
                      setWorks={setWorks}
                      works={works}
                    />
                  </Col>
                )}
                {(isAdmin ||
                  work.createdBy?._id.toString() === userId.toString()) && (
                  <Col xs="auto">
                    <ConfirmScheduledWork
                      work={work}
                      ticket={ticket}
                      setWorks={setWorks}
                      works={works}
                    />
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

export default ScheduledWorkItemDashboard;
