import { useRef, useState } from "react";

import useTicketAction from "../../../hooks/use-ticket-action";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Dropdown from "react-bootstrap/Dropdown";

import { RiTimeLine } from "react-icons/ri";

import { utcToLocalForm, localToUtc } from "../../../util/format-date";

const UpdateDeadline = ({ ticket, isOverdue }) => {
  const fetcher = useTicketAction();

  const deadlineInputRef = useRef();

  const [show, setShow] = useState(false);

  const showModal = () => {
    setShow(true);
  };

  const closeModal = () => {
    setShow(false);
  };

  const updateDeadlineHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      {
        intent: "updateDeadline",
        _id: ticket._id,
        // Настенное время в бизнес-таймзоне (пара к utcToLocalForm ниже).
        deadline: deadlineInputRef.current.value
          ? localToUtc(deadlineInputRef.current.value)
          : null,
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
      <Dropdown.Item
        variant={isOverdue ? "danger" : "info"}
        onClick={showModal}
      >
        <RiTimeLine /> Изменить дедлайн
      </Dropdown.Item>
      <Dropdown.Divider />
      <Modal show={show} onHide={closeModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Изменение дедлайна</Modal.Title>
        </Modal.Header>
        <Form onSubmit={updateDeadlineHandler}>
          <Modal.Body>
            <Form.Control
              type="datetime-local"
              ref={deadlineInputRef}
              required
              defaultValue={
                ticket.deadline ? utcToLocalForm(ticket.deadline) : ""
              }
            />
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
              value="updateDeadline"
              disabled={fetcher.state !== "idle"}
            >
              Подтвердить
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
};

export default UpdateDeadline;
