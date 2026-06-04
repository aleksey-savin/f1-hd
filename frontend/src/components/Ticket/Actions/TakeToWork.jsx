import { useState, useContext } from "react";
import { useFetcher } from "react-router";

import { RiCheckboxCircleLine } from "react-icons/ri";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Col from "react-bootstrap/Col";

import { AuthedUserContext } from "../../../store/authed-user-context";

const TakeToWork = ({ ticket }) => {
  const fetcher = useFetcher();
  const { _id: userId, permissions } = useContext(AuthedUserContext);
  const { canPerformTickets } = permissions;

  const responsibleIds = ticket.responsibles.map((user) => user._id.toString());
  const isResponsible = responsibleIds.includes(userId);
  const hasNoResponsibles = ticket.responsibles.length === 0;
  const isOnlyResponsible = responsibleIds.length === 1 && isResponsible;

  // modal handling
  const [show, setShow] = useState(false);

  const showModal = () => {
    setShow(true);
  };
  const closeModal = () => {
    setShow(false);
    setTakeOver(false);
  };

  // take over switch handling
  const [takeOver, setTakeOver] = useState(false);
  const takeOverChangeHandler = () => {
    setTakeOver(!takeOver);
  };

  // Без ответственных принятие в работу всегда означает «взять на себя».
  const effectiveTakeOver = hasNoResponsibles || takeOver;

  // Переключатель «Взять на себя» показываем только когда он имеет смысл:
  // — у заявки нет ответственных (берём её себе — переключатель включён и
  //   заблокирован);
  // — есть и другие ответственные кроме текущего пользователя.
  // Если пользователь — единственный ответственный, переключатель не нужен.
  const showTakeOverSwitch = !isOnlyResponsible;

  // Принять в работу можно после обработки менеджером (state «Не в работе»), если
  // пользователь — ответственный, либо если у заявки нет ответственных (тогда её
  // может взять любой исполнитель).
  const canTakeToWork =
    ticket.state === "Не в работе" &&
    (isResponsible || (hasNoResponsibles && canPerformTickets));

  const submitHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      { intent: "takeToWork", _id: ticket._id, takeOver: effectiveTakeOver },
      {
        method: "POST",
        action: `/tickets/${ticket.num}`,
      },
    );
    closeModal();
  };

  if (!canTakeToWork) return null;

  return (
    <Col sm="auto">
      <Button
        size="lg"
        variant="success"
        disabled={fetcher.state !== "idle"}
        onClick={showModal}
        className="w-100 mb-2"
      >
        <strong>
          <RiCheckboxCircleLine /> Принять в работу
        </strong>
      </Button>

      <Modal show={show} onHide={closeModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Принять в работу</Modal.Title>
        </Modal.Header>
        <Form onSubmit={submitHandler}>
          <Modal.Body>
            {showTakeOverSwitch ? (
              <Form.Group className="mb-3">
                <Form.Check
                  type="switch"
                  label="Взять на себя"
                  checked={effectiveTakeOver}
                  disabled={hasNoResponsibles}
                  onChange={takeOverChangeHandler}
                />
              </Form.Group>
            ) : (
              <p className="mb-0">Принять заявку в работу?</p>
            )}
            {effectiveTakeOver && (
              <Alert variant="warning" className="mt-3 mb-0">
                {hasNoResponsibles
                  ? "У заявки нет ответственных. После подтверждения вы станете единственным ответственным за эту заявку."
                  : "После подтверждения вы останетесь единственным ответственным за эту заявку."}
              </Alert>
            )}
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
              value="takeToWork"
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

export default TakeToWork;
