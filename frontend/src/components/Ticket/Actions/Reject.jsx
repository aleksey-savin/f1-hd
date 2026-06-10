import { useRef, useState } from "react";

import useTicketAction from "../../../hooks/use-ticket-action";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Col from "react-bootstrap/Col";
import Dropdown from "react-bootstrap/Dropdown";

import { RiCloseCircleLine } from "react-icons/ri";

const RejectTicket = ({ ticket, type }) => {
  const fetcher = useTicketAction();

  const rejectDesc = useRef();
  const [show, setShow] = useState(false);

  const showModal = () => {
    setShow(true);
  };

  const closeModal = () => {
    setShow(false);
  };

  const rejectTicketHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      {
        intent: "reject",
        _id: ticket._id,
        rejectDesc: rejectDesc.current.value,
        expectedVersion: ticket.version,
      },
      {
        method: "POST",
        action: `/tickets/${ticket.num}`,
      }
    );

    closeModal();
  };

  return (
    <>
      {type === "dropdown" && (
        <>
          <Dropdown.Item onClick={showModal}>
            <RiCloseCircleLine /> Отказаться
          </Dropdown.Item>
          <Dropdown.Divider />
        </>
      )}
      {type === "button" && ticket.state === "Не в работе" && (
        <Col sm="auto" className="mb-2">
          <Button
            size="lg"
            variant="danger"
            className="w-100"
            onClick={showModal}
          >
            <RiCloseCircleLine /> Отказаться
          </Button>
        </Col>
      )}
      <Modal show={show} onHide={closeModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Отказаться от Заявки</Modal.Title>
        </Modal.Header>
        <Form onSubmit={rejectTicketHandler}>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="reject-desc">Причина отказа</Form.Label>
              <Form.Control as="textarea" required rows={2} ref={rejectDesc} />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={closeModal}
              disabled={fetcher.state !== "idle"}
            >
              Закрыть
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              Подтвердить
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};
export default RejectTicket;
