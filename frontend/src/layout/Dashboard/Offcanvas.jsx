import Container from "react-bootstrap/Container";
import Offcanvas from "react-bootstrap/Offcanvas";

import TicketsList from "../../components/Ticket/List";

const TicketsOffcanvas = ({ show, handleClose, list = [] }) => {
  return (
    <Offcanvas
      className="h-100"
      show={show.active}
      onHide={handleClose}
      onEscapeKeyDown={handleClose}
      placement="bottom"
    >
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>{`${list.title || ""}`}</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        <Container>
          <TicketsList items={list.items} />
        </Container>
      </Offcanvas.Body>
    </Offcanvas>
  );
};

export default TicketsOffcanvas;
