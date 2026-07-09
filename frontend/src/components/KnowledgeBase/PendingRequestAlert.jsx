import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";

import { RiDeleteBin6Line, RiArchiveLine, RiCloseLine } from "react-icons/ri";

import { formatActor } from "../../util/knowledgeNoteTypes";
import { formatShortDate } from "../../util/format-date";

// Запрос коллеги, ожидающий решения модератора. Раньше «Подтвердить удаление» и
// «Отклонить запрос на архивацию» лежали в общем меню действий — решение
// принималось вслепую, без контекста: кто попросил и когда. Теперь запрос сам
// приходит к модератору строкой под шапкой заметки, вместе с кнопками решения.
// Менеджеру (не модератору) алерт объясняет, чего ждёт его собственный запрос.
const PendingRequestAlert = ({
  note,
  isModerator,
  isLoading,
  onConfirmDeletion,
  onDeclineDeletion,
  onConfirmArchive,
  onDeclineArchive,
}) => {
  if (!note || note.archivedAt) {
    return null;
  }

  const request = note.pendingDeletion
    ? {
        variant: "danger",
        icon: <RiDeleteBin6Line aria-hidden="true" />,
        action: "удаление",
        actor: formatActor(note.pendingDeletionBy),
        at: note.pendingDeletionAt,
        confirmLabel: "Удалить",
        confirmVariant: "danger",
        onConfirm: onConfirmDeletion,
        onDecline: onDeclineDeletion,
        waiting: "Заметка ждёт решения модератора и будет удалена безвозвратно.",
      }
    : note.pendingArchive
      ? {
          variant: "warning",
          icon: <RiArchiveLine aria-hidden="true" />,
          action: "архивацию",
          actor: formatActor(note.pendingArchiveBy),
          at: note.pendingArchiveAt,
          confirmLabel: "В архив",
          confirmVariant: "secondary",
          onConfirm: onConfirmArchive,
          onDecline: onDeclineArchive,
          waiting: "Заметка ждёт решения модератора.",
        }
      : null;

  if (!request) {
    return null;
  }

  const who = request.actor || "Сотрудник";
  const when = request.at ? ` ${formatShortDate(request.at)}` : "";

  return (
    <Alert variant={request.variant} className="mb-3">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <span className="fw-semibold">
          {request.icon} {who} запросил {request.action}
          {when}
        </span>
        {isModerator ? (
          <span className="d-flex gap-2 ms-auto">
            <Button
              size="sm"
              variant={request.confirmVariant}
              onClick={request.onConfirm}
              disabled={isLoading}
            >
              {request.confirmLabel}
            </Button>
            <Button
              size="sm"
              variant="outline-secondary"
              className="alert-action-btn"
              onClick={request.onDecline}
              disabled={isLoading}
            >
              <RiCloseLine /> Отклонить
            </Button>
          </span>
        ) : (
          <span className="ms-auto small">{request.waiting}</span>
        )}
      </div>
    </Alert>
  );
};

export default PendingRequestAlert;
