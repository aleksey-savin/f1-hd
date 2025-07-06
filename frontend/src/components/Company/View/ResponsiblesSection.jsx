import React from "react";
import { Badge } from "react-bootstrap";
import AlertMessage from "../../../UI/AlertMessage";

const ResponsibleGroup = ({ title, responsibles, nameFormatter }) => (
  <div className="mb-3">
    <h6 className="text-muted mb-2">{title}</h6>
    <div>
      {responsibles && responsibles.length > 0 ? (
        responsibles.map((responsible) => (
          <Badge bg="secondary" key={responsible._id} className="me-2 mb-2 p-2">
            {nameFormatter(responsible)}
          </Badge>
        ))
      ) : (
        <AlertMessage variant="light" message="Не указаны" />
      )}
    </div>
  </div>
);

const ResponsiblesSection = ({ company }) => {
  const { clientsSideResponsibles, responsibles } = company;

  const formatClientName = (client) =>
    client.fullName
      ? client.fullName
      : `${client.lastName} ${client.firstName}`;
  const formatSpecialistName = (responsible) =>
    `${responsible.lastName} ${responsible.firstName}`;

  return (
    <>
      <h4>Ответственные лица</h4>
      <ResponsibleGroup
        title="Со стороны клиента"
        responsibles={clientsSideResponsibles}
        nameFormatter={formatClientName}
      />
      <ResponsibleGroup
        title="Со стороны исполнителя"
        responsibles={responsibles}
        nameFormatter={formatSpecialistName}
      />
    </>
  );
};

export default ResponsiblesSection;
