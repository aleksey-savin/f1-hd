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
  const { _id: userId } = useContext(AuthedUserContext);

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

  const submitHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      { intent: "takeToWork", _id: ticket._id, takeOver: takeOver },
      {
        method: "POST",
        action: `/tickets/${ticket.num}`,
      },
    );
    closeModal();
  };

  return (
    <>
      {ticket.state === "Не в работе" &&
        ticket.responsibles
          .map((user) => user._id.toString())
          .includes(userId) && (
          <>
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
                    <Form.Group className="mb-3">
                      <Form.Check
                        type="switch"
                        label="Взять на себя"
                        value={takeOver}
                        onChange={takeOverChangeHandler}
                      />
                    </Form.Group>
                    {takeOver && (
                      <>
                        <Alert variant="warning">
                          После подтверждения вы останетесь единственным
                          ответственным за эту заявку.
                        </Alert>
                      </>
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
          </>
        )}
    </>
  );
};

export default TakeToWork;
