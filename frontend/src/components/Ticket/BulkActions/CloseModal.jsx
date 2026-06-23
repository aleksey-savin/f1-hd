import { useState } from "react";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";

// Массовое закрытие. Один и тот же результат выполнения сохраняется как
// комментарий и closingComment каждой заявки. Правило о работах соблюдается на
// бэкенде (а на клиенте кнопка для заявок без работ заблокирована заранее).
const CloseModal = ({ show, onHide, count, onConfirm }) => {
  const [closingComment, setClosingComment] = useState("");

  const close = () => {
    setClosingComment("");
    onHide();
  };

  const submitHandler = (event) => {
    event.preventDefault();
    onConfirm({ closingComment });
    close();
  };

  return (
    <Modal show={show} onHide={close} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Закрыть заявки ({count})</Modal.Title>
      </Modal.Header>
      <Form onSubmit={submitHandler}>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Результат выполнения</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              required
              value={closingComment}
              onChange={(e) => setClosingComment(e.target.value)}
              placeholder='Например, "Добрый день! Проблема устранена."'
            />
          </Form.Group>
          <Alert variant="warning" className="mb-0">
            <ul className="mb-0">
              <li>
                Это сообщение будет отправлено инициаторам выбранных заявок.
              </li>
              <li>
                Из ответственных будут удалены пользователи, не указавшие работы
                и не имеющие разрешения их не указывать.
              </li>
            </ul>
          </Alert>
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

export default CloseModal;
