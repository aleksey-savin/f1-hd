import { RiDeleteBin6Line, RiArchiveLine, RiCloseLine } from "react-icons/ri";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { formatActor } from "../../util/knowledgeNoteTypes";
import { formatShortDate } from "../../util/format-date";

// Запрос коллеги, ожидающий решения модератора. Решение, спрятанное в меню,
// принимается вслепую: не видно ни кто попросил, ни когда. Поэтому запрос сам
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
        variant: "destructive",
        icon: <RiDeleteBin6Line aria-hidden />,
        action: "удаление",
        actor: formatActor(note.pendingDeletionBy),
        at: note.pendingDeletionAt,
        confirmLabel: "Удалить",
        onConfirm: onConfirmDeletion,
        onDecline: onDeclineDeletion,
        waiting:
          "Заметка ждёт решения модератора и будет удалена безвозвратно.",
      }
    : note.pendingArchive
      ? {
          variant: "warning",
          icon: <RiArchiveLine aria-hidden />,
          action: "архивацию",
          actor: formatActor(note.pendingArchiveBy),
          at: note.pendingArchiveAt,
          confirmLabel: "В архив",
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
    <Alert
      variant={request.variant}
      // У сток-варианта destructive фон карточки; запрос на удаление обязан
      // читаться как требующий решения — подкрашиваем, как warning-вариант
      className={
        request.variant === "destructive"
          ? "mt-4 border-destructive/30 bg-destructive/10"
          : "mt-4"
      }
    >
      {request.icon}
      <AlertTitle className="flex flex-wrap items-center gap-2 line-clamp-none">
        <span>
          {who} запросил {request.action}
          {when}
        </span>
        {isModerator ? (
          // Кнопки внутри цветного алерта наследуют его цвет (currentColor)
          <span className="ms-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-current bg-transparent text-current"
              onClick={request.onConfirm}
              disabled={isLoading}
            >
              {request.confirmLabel}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-current"
              onClick={request.onDecline}
              disabled={isLoading}
            >
              <RiCloseLine /> Отклонить
            </Button>
          </span>
        ) : (
          <span className="ms-auto text-sm font-normal">{request.waiting}</span>
        )}
      </AlertTitle>
    </Alert>
  );
};

export default PendingRequestAlert;
