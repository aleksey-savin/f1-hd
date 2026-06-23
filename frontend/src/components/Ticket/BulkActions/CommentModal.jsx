import { useState } from "react";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Form from "react-bootstrap/Form";

// Массовый комментарий: один и тот же текст добавляется к каждой выбранной заявке.
// Вложения для bulk не поддерживаем.
const CommentModal = ({ show, onHide, count, onConfirm }) => {
  const [content, setContent] = useState("");

  const close = () => {
    setContent("");
    onHide();
  };

  const submitHandler = (event) => {
    event.preventDefault();
    onConfirm({ content });
    close();
  };

  return (
    <Modal show={show} onHide={close} centered>
      <Modal.Header closeButton>
        <Modal.Title>Комментарий к заявкам ({count})</Modal.Title>
      </Modal.Header>
      <Form onSubmit={submitHandler}>
        <Modal.Body>
          <Form.Group>
            <Form.Label>
              Один комментарий будет добавлен ко всем выбранным заявкам.
            </Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={close}>
            Отмена
          </Button>
          <Button type="submit">Добавить</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default CommentModal;
