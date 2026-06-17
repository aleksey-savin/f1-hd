import { Row, Col, Card, Badge, Button } from "react-bootstrap";
import { Link } from "react-router";

import AlertMessage from "../../../UI/AlertMessage";

import { HiOutlineMagnifyingGlass } from "react-icons/hi2";
import {
  RiContactsBook2Line,
  RiUser3Line,
  RiMailLine,
  RiPhoneLine,
} from "react-icons/ri";

const getFullName = (person) =>
  person.fullName ||
  [person.lastName, person.firstName].filter(Boolean).join(" ") ||
  "Без имени";

// Развёрнутая карточка ответственного: должность, роль, контакты и ссылка на профиль
const ResponsibleCard = ({ person }) => (
  <Card className="border shadow-none h-100">
    <Card.Body className="d-flex align-items-start gap-3">
      <span className="contact-row__icon">
        <RiUser3Line />
      </span>
      <div className="flex-grow-1" style={{ minWidth: 0 }}>
        <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
          <span className="fw-semibold">{getFullName(person)}</span>
          {person.role && (
            <Badge bg="secondary" className="fw-normal">
              {person.role}
            </Badge>
          )}
          {person.isActive === false && (
            <Badge bg="danger" className="fw-normal">
              отключён
            </Badge>
          )}
        </div>
        {person.position && (
          <div className="text-body-secondary small mb-2">
            {person.position}
          </div>
        )}
        <div className="d-flex flex-column gap-1 small">
          {person.email && (
            <a href={`mailto:${person.email}`} className="user-item-field">
              <RiMailLine />
              <span>{person.email}</span>
            </a>
          )}
          {person.phone && (
            <a href={`tel:${person.phone}`} className="user-item-field">
              <RiPhoneLine />
              <span>{person.phone}</span>
            </a>
          )}
          {!person.email && !person.phone && (
            <span className="text-body-secondary">Контакты не указаны</span>
          )}
        </div>
      </div>
      {person.id && (
        <Button
          as={Link}
          to={`/users/${person.id}`}
          target="_blank"
          size="sm"
          variant="outline-secondary"
          className="flex-shrink-0"
          title="Открыть профиль"
        >
          <HiOutlineMagnifyingGlass />
        </Button>
      )}
    </Card.Body>
  </Card>
);

const ResponsibleGroup = ({ title, people }) => (
  <div className="mb-4">
    <h6 className="text-body-secondary text-uppercase small mb-2">{title}</h6>
    {people && people.length > 0 ? (
      <Row className="row-cols-1 row-cols-md-2 g-3">
        {people.map((person) => (
          <Col key={person._id || person.id}>
            <ResponsibleCard person={person} />
          </Col>
        ))}
      </Row>
    ) : (
      <AlertMessage variant="light" message="Не указаны" />
    )}
  </div>
);

const ResponsiblesSection = ({ company }) => {
  const { clientsSideResponsibles, responsibles } = company;

  return (
    <>
      <div className="cap-card-title mb-3">
        <RiContactsBook2Line />
        <span>Ответственные лица</span>
      </div>
      <ResponsibleGroup
        title="Со стороны клиента"
        people={clientsSideResponsibles}
      />
      <ResponsibleGroup title="Со стороны исполнителя" people={responsibles} />
    </>
  );
};

export default ResponsiblesSection;
