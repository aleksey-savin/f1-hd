import { useState } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";

import { RiShieldCheckLine } from "react-icons/ri";

// «N заметок» с правильным окончанием — модератор проверяет и по одной, и пачкой.
const notesPlural = (count) => {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} заметок`;
  switch (count % 10) {
    case 1:
      return `${count} заметку`;
    case 2:
    case 3:
    case 4:
      return `${count} заметки`;
    default:
      return `${count} заметок`;
  }
};

// Диалог проверки заметки. Обе галочки выключены по умолчанию; «Проверить»
// активна только когда подтверждены оба условия — это и есть смысл отметки
// «Проверено»: модератор ручается за актуальность и отсутствие секретов.
// count > 1 — та же аттестация сразу для выделенных заметок.
const VerifyModal = ({ show, onHide, onConfirm, isLoading, count = 1 }) => {
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

  const subject = count > 1 ? notesPlural(count) : "эта запись";
  const verb = count > 1 ? "содержат" : "содержит";

  return (
    <Modal show={show} onHide={hide} centered>
      <Modal.Header closeButton>
        <Modal.Title>
          {count > 1 ? `Проверка: ${notesPlural(count)}` : "Проверка заметки"}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Check
          type="switch"
          id="verify-confirm-current"
          className="mb-3"
          checked={confirmCurrent}
          onChange={(event) => setConfirmCurrent(event.target.checked)}
          label={`Я подтверждаю, что ${subject} ${verb} только актуальные данные`}
        />
        <Form.Check
          type="switch"
          id="verify-confirm-no-secrets"
          checked={confirmNoSecrets}
          onChange={(event) => setConfirmNoSecrets(event.target.checked)}
          label={`Я подтверждаю, что ${subject} не ${verb} паролей, ключей шифрования, данных для активации программных продуктов и иных чувствительных данных`}
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
          <RiShieldCheckLine /> Проверить
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default VerifyModal;
