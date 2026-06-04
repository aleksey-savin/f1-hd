import { useState, useContext } from "react";
import { useFetcher } from "react-router";

import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Col from "react-bootstrap/Col";

import { RiLinksFill } from "react-icons/ri";

import { AuthedUserContext } from "../../../store/authed-user-context";

const JoinResponsibles = ({ ticket }) => {
  const fetcher = useFetcher();

  const { permissions, _id: userId } = useContext(AuthedUserContext);
  const { canPerformTickets } = permissions;

  const { state } = ticket;

  // modal handling
  const [show, setShow] = useState(false);

  const showModal = () => {
    setShow(true);
  };
  const closeModal = () => {
    setShow(false);
  };

  const submitHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      { intent: "join", _id: ticket._id },
      {
        method: "POST",
        action: `/tickets/${ticket.num}`,
      },
    );

    closeModal();
  };

  const canJoin =
    canPerformTickets &&
    !ticket.responsibles
      .map((user) => user._id.toString())
      .includes(userId) &&
    state !== "Закрыта";

  if (!canJoin) return null;

  return (
    <Col sm="auto">
      <Button
        variant="success"
        disabled={fetcher.state !== "idle"}
        onClick={showModal}
        size="lg"
        className="w-100 mb-2"
      >
        <strong>
          <RiLinksFill /> Присоединиться
        </strong>
      </Button>

      <Modal show={show} onHide={closeModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Присоединиться</Modal.Title>
        </Modal.Header>
        <Form onSubmit={submitHandler}>
          <Modal.Body>
            <p className="mb-0">Присоединиться к ответственным за заявку?</p>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={closeModal}
              disabled={fetcher.state !== "idle"}
            >
              Закрыть
            </Button>
            <Button
              type="submit"
              name="intent"
              value="join"
              disabled={fetcher.state !== "idle"}
            >
              Подтвердить
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </Col>
  );
};

export default JoinResponsibles;
