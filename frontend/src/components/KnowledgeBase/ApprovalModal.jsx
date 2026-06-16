import { useState } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";

// Диалог одобрения заметки. Обе галочки выключены по умолчанию; кнопка
// «Одобрить» активна только когда подтверждены оба условия.
const ApprovalModal = ({ show, onHide, onConfirm, isLoading }) => {
  const [confirmCurrent, setConfirmCurrent] = useState(false);
  const [confirmNoSecrets, setConfirmNoSecrets] = useState(false);

  const reset = () => {
    setConfirmCurrent(false);
    setConfirmNoSecrets(false);
  };

  const hide = () => {
    reset();
    onHide();
  };

  const confirm = () => {
    onConfirm({ confirmCurrent, confirmNoSecrets }, reset);
  };

  return (
    <Modal show={show} onHide={hide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Одобрение заметки</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Check
          type="switch"
          id="approve-confirm-current"
          className="mb-3"
          checked={confirmCurrent}
          onChange={(event) => setConfirmCurrent(event.target.checked)}
          label="Я подтверждаю, что эта запись содержит только актуальные данные"
        />
        <Form.Check
          type="switch"
          id="approve-confirm-no-secrets"
          checked={confirmNoSecrets}
          onChange={(event) => setConfirmNoSecrets(event.target.checked)}
          label="Я подтверждаю, что эта запись не содержит паролей, ключей шифрования, данных для активации программных продуктов и иных чувствительных данных"
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={hide} disabled={isLoading}>
          Отмена
        </Button>
        <Button
          variant="success"
          onClick={confirm}
          disabled={!confirmCurrent || !confirmNoSecrets || isLoading}
        >
          Одобрить
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ApprovalModal;
