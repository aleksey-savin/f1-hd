import { NavLink } from "react-router";

import { formatDate } from "../../util/format-date";

import ItemCard from "../../UI/ItemCard";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Badge from "react-bootstrap/Badge";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Popover from "react-bootstrap/Popover";
import Button from "react-bootstrap/Button";

import { FaRegCalendar, FaRegComment } from "react-icons/fa";
import { IoMdAttach } from "react-icons/io";
import { RiBuilding2Line } from "react-icons/ri";

import { formatDateTime } from "../../util/format-date";
import { msToHMS } from "../../util/time-helpers";
import { BrowserView, MobileView } from "react-device-detect";

const TicketItem = ({ item, isSelected, onSelect }) => {
  const {
    num,
    company,
    title,
    attachments,
    applicant,
    realSender,
    responsibles,
    createdAt,
    deadline,
    finishedAt,
    state,
    isClosed,
    routineTask,
    latestComment,
    scheduledWorks,
  } = item;

  const TitleContent = () => {
    return (
      <>
        <BrowserView>
          <Button
            bg="primary"
            className="me-2"
            as={NavLink}
            to={`/tickets/${num}`}
          >
            <h5 className="m-0">
              <strong>{num}</strong>
            </h5>
          </Button>
          {`${title}`}
        </BrowserView>
        <MobileView>
          <Row>
            <Col className="col-3">
              <Badge bg="primary" as={NavLink} to={`/tickets/${num}`}>
                {num}
              </Badge>
            </Col>
            <Col className="col-9">
              <Badge className="w-100 py-1" bg="secondary">
                <RiBuilding2Line /> {company?.alias}
              </Badge>
            </Col>
            <Col className="pt-2">{title}</Col>
          </Row>
        </MobileView>
      </>
    );
  };

  const badgeBg =
    state === "Новая"
      ? "warning"
      : state === "Не в работе"
        ? "warning"
        : state === "В работе"
          ? "info"
          : state === "Выполнена"
            ? "success"
            : state === "Закрыта"
              ? "secondary"
              : "info";

  const isOverdue =
    new Date(deadline) < new Date() && state !== "Закрыта" ? true : false;

  const badges = [
    { title: state.toLowerCase(), isActive: true, bg: badgeBg },
    { title: "просрочена", isActive: isOverdue && !isClosed, bg: "danger" },
    { title: "регламент", isActive: routineTask, bg: "primary" },
  ];

  const latestCommentPopover = (
    <Popover style={{ maxWidth: "30rem" }}>
      <Popover.Header as="h3">Последний комментарий</Popover.Header>
      <Popover.Body>
        <p>
          <strong>{`${latestComment?.createdBy.lastName} ${latestComment?.createdBy.firstName}`}</strong>{" "}
          <span
            className={
              latestComment?.attachments?.length > 0
                ? "text-body-secondary"
                : "text-body-secondary mb-0"
            }
          >{`${formatDate(latestComment?.createdAt)}`}</span>
        </p>
        <p className={latestComment?.attachments ? "mb-2" : "mb-0"}>
          {latestComment?.content}
        </p>
        {latestComment?.attachments && (
          <>
            {latestComment?.attachments.map((a) => (
              <Row key={a.name}>
                <Col sm="12">
                  <a
                    href={`${import.meta.env.VITE_API_ADDRESS}/uploads/${a.name}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {a.name}
                  </a>
                </Col>
              </Row>
            ))}
          </>
        )}
      </Popover.Body>
    </Popover>
  );

  const scheduledWorksPopover = (
    <Popover style={{ maxWidth: "30rem" }}>
      <Popover.Header as="h3">Запланированные работы</Popover.Header>
      <Popover.Body>
        {scheduledWorks?.map((work) => (
          <div key={work._id}>
            <Row className="mb-2">
              <Col>
                <strong>{`${work?.executor?.lastName} ${work?.executor?.firstName}`}</strong>
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
            <Row className="mb-3">
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
          </div>
        ))}
      </Popover.Body>
    </Popover>
  );

  const attachmentsPopover = (
    <Popover style={{ maxWidth: "30rem" }}>
      <Popover.Header as="h3">Прикреплённые файлы</Popover.Header>
      <Popover.Body>
        {attachments?.map((a) => (
          <Row key={a.name} className="mb-2">
            <Col sm="12">
              <a
                href={`${import.meta.env.VITE_API_ADDRESS}/uploads/${a.name}`}
                target="_blank"
                rel="noreferrer"
              >
                {a.name}
              </a>
            </Col>
          </Row>
        ))}
      </Popover.Body>
    </Popover>
  );

  const handleCardClick = (e) => {
    // Don't trigger selection if clicking on a button or link
    if (
      e.target.tagName === "BUTTON" ||
      e.target.tagName === "A" ||
      e.target.closest("button") ||
      e.target.closest("a") ||
      e.target.closest(".overlay-trigger") // Add this class to OverlayTrigger wrappers
    ) {
      return;
    }
    onSelect(item._id);
  };

  return (
    <ItemCard
      item={item}
      itemTitle="ticket"
      detailsButton
      danger={isOverdue}
      badges={badges}
      isSelected={isSelected}
      onClick={handleCardClick}
      style={{ cursor: "pointer" }}
      title={
        <div className="d-flex align-items-center">
          <TitleContent />
        </div>
      }
    >
      <Row>
        <Col>
          <div className="py-1">
            <BrowserView>
              Компания:
              <Badge className="ms-2" bg="secondary">
                <RiBuilding2Line /> {company?.alias}
              </Badge>
            </BrowserView>
          </div>
          <div className="py-1">
            Инициатор:
            <Badge bg="secondary" className="ms-2">
              {applicant
                ? applicant.lastName + " " + applicant.firstName
                : realSender
                  ? realSender
                  : "неизвестен"}
            </Badge>
          </div>
          {responsibles.length > 0 && (
            <div className="py-1">
              Ответственные:
              {responsibles?.map((user) => {
                return (
                  <Badge bg="secondary" className="ms-2" key={user._id}>
                    {user.lastName + " " + user.firstName}
                  </Badge>
                );
              })}
            </div>
          )}
          <div className="py-1">Создана: {formatDate(createdAt)}</div>
          <div className="py-1">
            {state !== "Закрыта" && deadline && (
              <> Дедлайн: {formatDate(deadline)}</>
            )}
            {state === "Закрыта" && <> Закрыта: {formatDate(finishedAt)}</>}
          </div>
          <div className="pt-2">
            <OverlayTrigger
              placement="top"
              trigger="click"
              delay={{ show: 250, hide: 400 }}
              overlay={scheduledWorksPopover}
              className="overlay-trigger"
            >
              <Button
                className="me-2"
                size="sm"
                disabled={scheduledWorks?.length === 0}
              >
                <FaRegCalendar />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger
              placement="top"
              trigger="click"
              delay={{ show: 250, hide: 400 }}
              overlay={attachmentsPopover}
              className="overlay-trigger"
            >
              <Button
                className="me-2"
                size="sm"
                disabled={attachments?.length === 0}
              >
                <IoMdAttach />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger
              placement="top"
              trigger="click"
              delay={{ show: 250, hide: 400 }}
              overlay={latestCommentPopover}
              className="overlay-trigger"
            >
              <Button className="me-2" size="sm" disabled={!latestComment}>
                <FaRegComment />
              </Button>
            </OverlayTrigger>
          </div>
        </Col>
      </Row>
    </ItemCard>
  );
};

export default TicketItem;
