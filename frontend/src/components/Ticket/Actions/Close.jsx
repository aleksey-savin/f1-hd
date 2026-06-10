import { useRef, useState, useContext, useEffect } from "react";
import { NavLink } from "react-router";

import useTicketAction from "../../../hooks/use-ticket-action";

import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import FormControl from "react-bootstrap/FormControl";
import Alert from "react-bootstrap/Alert";
import Col from "react-bootstrap/Col";

import { RiCheckboxCircleLine } from "react-icons/ri";

import { AuthedUserContext } from "../../../store/authed-user-context";
import useViewTicketStore from "../../../store/view-ticket";

import { SlActionRedo } from "react-icons/sl";

const CloseTicket = ({ scheduledWorks }) => {
  const fetcher = useTicketAction();
  const { ticket, works } = useViewTicketStore();

  const { isEndUser, permissions, _id: userId } = useContext(AuthedUserContext);
  const { canAvoidWorks, canUseTimeTrackingModule } = permissions;

  const [canBeClosed, setCanBeClosed] = useState(false);

  useEffect(() => {
    setCanBeClosed(
      canAvoidWorks ||
        works.filter((item) => item.finishedAt).length > 0 ||
        !canUseTimeTrackingModule,
    );
  }, [works]);

  // modal handling
  const [show, setShow] = useState(false);
  const showModal = () => {
    setShow(true);
  };
  const closeModal = () => {
    setShow(false);
  };

  const closingComment = useRef();

  const submitHandler = (event) => {
    event.preventDefault();

    fetcher.submit(
      {
        intent: "close",
        _id: ticket._id,
        closingComment: closingComment.current.value,
        expectedVersion: ticket.version,
      },
      {
        method: "POST",
        action: `/tickets/${ticket.num}`,
      },
    );
    closeModal();
  };

  const uncheckedChecklistItems =
    ticket.checklist?.filter((item) => item.checked === false).length > 0;

  return (
    <>
      {!isEndUser &&
        ticket.state === "В работе" &&
        ticket.responsibles
          .map((user) => user._id.toString())
          .includes(userId) && (
          <>
            <Col sm="auto">
              {canBeClosed && (
                <Button
                  variant="success"
                  size="lg"
                  className="w-100 mb-2"
                  onClick={showModal}
                  disabled={fetcher.state !== "idle" || scheduledWorks}
                >
                  <strong>
                    <RiCheckboxCircleLine /> Закрыть заявку
                  </strong>
                </Button>
              )}

              {!canBeClosed && (
                <Button
                  as={NavLink}
                  to="work/add"
                  size="lg"
                  variant="success"
                  className="mb-2 w-100"
                >
                  <SlActionRedo /> Указать работы
                </Button>
              )}
            </Col>

            <Modal show={show} onHide={closeModal} size="lg" centered>
              <Modal.Header closeButton>
                <Modal.Title>Закрыть заявку</Modal.Title>
              </Modal.Header>
              <Form onSubmit={submitHandler}>
                {uncheckedChecklistItems && (
                  <>
                    <Modal.Body>
                      <Alert variant="warning">
                        В чеклисте есть неотмеченные пункты. Убедитесь, что по
                        данной заявке выполнены все задачи, прежде чем закрыть
                        её.
                      </Alert>
                    </Modal.Body>
                    <Modal.Footer>
                      <Button
                        variant="secondary"
                        disabled={fetcher.state !== "idle"}
                        onClick={closeModal}
                      >
                        Закрыть
                      </Button>
                    </Modal.Footer>
                  </>
                )}
                {!uncheckedChecklistItems && (
                  <>
                    <Modal.Body>
                      <Form.Group className="mb-3">
                        <Form.Label htmlFor="description">
                          Результат выполнения
                        </Form.Label>
                        <Form.Group>
                          <FormControl
                            as="textarea"
                            placeholder='Например, "Добрый день! Проблема с Вашим компьютером устранена. Обновили операционную систему."'
                            required
                            rows={3}
                            ref={closingComment}
                          />
                        </Form.Group>
                      </Form.Group>
                      <Alert variant="warning">
                        <ul>
                          <li>
                            Это сообщение будет отправлено инициатору заявки.
                          </li>
                          <li>
                            Все пользователи, не указавшие работы и не имеющие
                            разрешения их не указывать, будут удалены из списка
                            ответственных.
                          </li>
                        </ul>
                      </Alert>
                    </Modal.Body>
                    <Modal.Footer>
                      <Button
                        variant="secondary"
                        disabled={fetcher.state !== "idle"}
                        onClick={closeModal}
                      >
                        Закрыть
                      </Button>
                      <Button type="submit" disabled={fetcher.state !== "idle"}>
                        Подтвердить
                      </Button>
                    </Modal.Footer>
                  </>
                )}
              </Form>
            </Modal>
          </>
        )}
    </>
  );
};

export default CloseTicket;
