import { useRef, useState, useContext } from "react";
import { useFetcher } from "react-router";

import Button from "react-bootstrap/Button";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import FormControl from "react-bootstrap/FormControl";

import { RiArrowGoBackFill } from "react-icons/ri";

import { AuthedUserContext } from "../../../store/authed-user-context";

const BackToWork = ({ ticket }) => {
  const fetcher = useFetcher();

  const { _id: userId, isAdmin, permissions } = useContext(AuthedUserContext);

  // modal handling
  const [show, setShow] = useState(false);

  const showModal = () => {
    setShow(true);
  };
  const closeModal = () => {
    setShow(false);
  };

  const returningComment = useRef();

  const submitHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      {
        intent: "backToWork",
        _id: ticket._id,
        returningComment: returningComment.current.value,
      },
      {
        method: "POST",
        action: `/tickets/${ticket.num}`,
      },
    );

    closeModal();
  };

  const canReturnTicketToWork =
    (ticket.state === "Закрыта" || ticket.state === "Выполнена") &&
    (ticket.applicant?._id === userId ||
      isAdmin ||
      permissions.canAdministrateTickets ||
      permissions.canPerformTickets);

  return (
    <>
      {canReturnTicketToWork && (
        <>
          <>
            <Col sm="auto">
              <Button
                className="mb-3 w-100"
                variant="warning"
                size="lg"
                onClick={showModal}
              >
                <strong>
                  <RiArrowGoBackFill /> Вернуть в работу
                </strong>
              </Button>
            </Col>
            <Modal show={show} onHide={closeModal} centered>
              <Modal.Header closeButton>
                <Modal.Title>Вернуть заявку в работу</Modal.Title>
              </Modal.Header>
              <Form onSubmit={submitHandler}>
                <Modal.Body>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="description">
                      Причина возврата в работу
                    </Form.Label>
                    <Form.Group>
                      <FormControl
                        as="textarea"
                        required
                        rows={2}
                        ref={returningComment}
                      />
                    </Form.Group>
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
        </>
      )}
    </>
  );
};

export default BackToWork;
