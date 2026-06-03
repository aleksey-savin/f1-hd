import { useContext } from "react";
import { NavLink } from "react-router";

import WorkItem from "./Item";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import ScheduledWorkItem from "./ScheduledItem";
import AlertMessage from "../../UI/AlertMessage";

import { AuthedUserContext } from "../../store/authed-user-context";
import Button from "react-bootstrap/esm/Button";
import useViewTicketStore from "../../store/view-ticket";

const WorksList = ({ ticket }) => {
  const { works } = useViewTicketStore();

  const { isEndUser, _id: userId } = useContext(AuthedUserContext);

  const finishedWorks = works.filter((item) => item.finishedAt);
  const scheduledWorks = works.filter(
    (item) => !item.finishedAt && item.planningToStart,
  );

  return (
    <>
      <Row className="mt-3">
        <Col>
          {scheduledWorks.length > 0 && (
            <>
              {scheduledWorks.map((work) => (
                <ScheduledWorkItem key={work._id.toString()} work={work} />
              ))}
            </>
          )}
          {finishedWorks.length > 0 && (
            <>
              {finishedWorks.map((work) => (
                <WorkItem
                  key={work._id.toString()}
                  work={work}
                  isArchived={ticket.isArchived}
                />
              ))}
            </>
          )}
          {scheduledWorks.length === 0 && finishedWorks.length === 0 && (
            <AlertMessage variant="light" message="Список пока пуст." />
          )}
        </Col>
      </Row>
      {!ticket.isArchived &&
        !isEndUser &&
        ticket.responsibles
          .map((user) => user._id.toString())
          .includes(userId) &&
        !["Новая", "Не в работе"].includes(ticket.state) && (
          <Row>
            <Col md="auto">
              <Button
                as={NavLink}
                variant="outline-info"
                size="lg"
                className="mb-2 w-100"
                to="work/add"
              >
                Добавить
              </Button>
            </Col>
            <Col md="auto">
              <Button
                as={NavLink}
                to="work/schedule"
                variant="outline-info"
                size="lg"
                className="mb-2 w-100"
              >
                Запланировать
              </Button>
            </Col>
          </Row>
        )}
    </>
  );
};

export default WorksList;
