import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";

// Универсальный диалог подтверждения действия: заголовок, текст и кнопки
// «Отмена» / подтверждение. Используется для запроса и подтверждения архивации.
const ConfirmActionModal = ({
  show,
  onHide,
  onConfirm,
  title,
  body,
  confirmLabel = "Подтвердить",
  confirmVariant = "primary",
  isLoading,
}) => (
  <Modal show={show} onHide={onHide} centered>
    <Modal.Header closeButton>
      <Modal.Title>{title}</Modal.Title>
    </Modal.Header>
    <Modal.Body>{body}</Modal.Body>
    <Modal.Footer>
      <Button variant="outline-secondary" onClick={onHide} disabled={isLoading}>
        Отмена
      </Button>
      <Button variant={confirmVariant} onClick={onConfirm} disabled={isLoading}>
        {confirmLabel}
      </Button>
    </Modal.Footer>
  </Modal>
);

export default ConfirmActionModal;
