import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";

// Диалог подтверждения удаления заметки модератором. Предупреждает, что заметка
// будет безвозвратно удалена из приложения.
const ConfirmDeletionModal = ({ show, onHide, onConfirm, isLoading }) => (
  <Modal show={show} onHide={onHide} centered>
    <Modal.Header closeButton>
      <Modal.Title>Подтверждение удаления</Modal.Title>
    </Modal.Header>
    <Modal.Body>
      Заметка будет безвозвратно удалена из приложения. Это действие нельзя
      отменить.
    </Modal.Body>
    <Modal.Footer>
      <Button variant="outline-secondary" onClick={onHide} disabled={isLoading}>
        Отмена
      </Button>
      <Button variant="danger" onClick={onConfirm} disabled={isLoading}>
        Удалить безвозвратно
      </Button>
    </Modal.Footer>
  </Modal>
);

export default ConfirmDeletionModal;
