import Button from "react-bootstrap/Button";
import Dropdown from "react-bootstrap/Dropdown";

import {
  RiEditLine,
  RiSaveLine,
  RiArrowGoBackFill,
  RiShieldCheckLine,
  RiDeleteBinLine,
  RiArchiveLine,
  RiInboxUnarchiveLine,
  RiMoreLine,
} from "react-icons/ri";

// Действия над заметкой. Ровно одна залитая кнопка — та, которую от пользователя
// ждут прямо сейчас (модератору непроверенной заметки — «Проверить», остальным —
// «Редактировать»). Редкое и опасное живёт в icon-only меню «⋯»; безликой
// подписи «Действия» больше нет. Решения по чужим запросам (подтвердить/отклонить
// удаление и архивацию) сюда не попадают — они показаны инлайновым алертом
// рядом с контекстом (PendingRequestAlert).
const NoteActions = ({
  note,
  isNew,
  isEditing,
  isLoading,
  canManage,
  isModerator,
  onEdit,
  onSave,
  onCancel,
  onVerify,
  onSendToDeletion,
  onRequestArchive,
  onUnarchive,
}) => {
  if (isEditing) {
    return (
      <div className="d-flex gap-2 flex-wrap">
        <Button variant="primary" onClick={onSave} disabled={isLoading}>
          <RiSaveLine /> Сохранить
        </Button>
        <Button
          variant="outline-secondary"
          onClick={onCancel}
          disabled={isLoading}
        >
          <RiArrowGoBackFill /> Отмена
        </Button>
      </div>
    );
  }

  if (isNew || !note) {
    return null;
  }

  // Архивная заметка живёт по одному правилу: сначала восстанови, потом правь.
  if (note.archivedAt) {
    return canManage ? (
      <Button variant="primary" onClick={onUnarchive} disabled={isLoading}>
        <RiInboxUnarchiveLine /> Восстановить из архива
      </Button>
    ) : null;
  }

  const needsVerification = isModerator && note.approved !== true;

  const menuItems = [];
  if (canManage && !note.pendingArchive) {
    menuItems.push(
      <Dropdown.Item key="archive" onClick={onRequestArchive}>
        <RiArchiveLine className="me-2" />
        Запросить архивацию
      </Dropdown.Item>,
    );
  }
  if (canManage && !note.pendingDeletion) {
    menuItems.push(
      <Dropdown.Item
        key="delete"
        className="text-danger"
        onClick={onSendToDeletion}
      >
        <RiDeleteBinLine className="me-2" />
        Отправить на удаление
      </Dropdown.Item>,
    );
  }

  return (
    <div className="d-flex gap-2 flex-wrap align-items-start">
      {needsVerification && (
        <Button variant="success" onClick={onVerify} disabled={isLoading}>
          <RiShieldCheckLine /> Проверить
        </Button>
      )}
      {canManage && (
        <Button
          variant={needsVerification ? "outline-secondary" : "primary"}
          onClick={onEdit}
          disabled={isLoading}
        >
          <RiEditLine /> Редактировать
        </Button>
      )}
      {menuItems.length > 0 && (
        <Dropdown align="end">
          <Dropdown.Toggle
            variant="outline-secondary"
            className="kb-actions__more"
            title="Ещё действия"
            aria-label="Ещё действия"
          >
            <RiMoreLine />
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Header>Жизненный цикл</Dropdown.Header>
            {menuItems}
          </Dropdown.Menu>
        </Dropdown>
      )}
    </div>
  );
};

export default NoteActions;
