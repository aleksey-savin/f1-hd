import { useState } from "react";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";

// Массовое «Принять в работу». Переключатель «Взять на себя» применяется ко всем
// выбранным заявкам: на бэкенде для каждой заявки текущий пользователь становится
// единственным ответственным (а у заявок без ответственных он добавляется в любом
// случае).
const TakeToWorkModal = ({ show, onHide, count, onConfirm }) => {
  const [takeOver, setTakeOver] = useState(false);

  const close = () => {
    setTakeOver(false);
    onHide();
  };

  const submitHandler = (event) => {
    event.preventDefault();
    onConfirm({ takeOver });
    close();
  };

  return (
    <Modal show={show} onHide={close} centered>
      <Modal.Header closeButton>
        <Modal.Title>Принять в работу ({count})</Modal.Title>
      </Modal.Header>
      <Form onSubmit={submitHandler}>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Check
              type="switch"
              label="Взять на себя"
              checked={takeOver}
              onChange={() => setTakeOver((v) => !v)}
            />
          </Form.Group>
          {takeOver && (
            <Alert variant="warning" className="mb-0">
              После подтверждения вы останетесь единственным ответственным по
              выбранным заявкам.
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={close}>
            Отмена
          </Button>
          <Button type="submit" variant="success">
            Подтвердить
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default TakeToWorkModal;
