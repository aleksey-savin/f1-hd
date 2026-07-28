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
        waiting: "Заметка ждёт решения модератора и будет удалена безвозвратно.",
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
          ? "tw:mt-4 tw:border-destructive/30 tw:bg-destructive/10"
          : "tw:mt-4"
      }
    >
      {request.icon}
      <AlertTitle className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:line-clamp-none">
        <span>
          {who} запросил {request.action}
          {when}
        </span>
        {isModerator ? (
          // Кнопки внутри цветного алерта наследуют его цвет (currentColor)
          <span className="tw:ms-auto tw:flex tw:gap-2">
            <Button
              size="sm"
              variant="outline"
              className="tw:border-current tw:bg-transparent tw:text-current"
              onClick={request.onConfirm}
              disabled={isLoading}
            >
              {request.confirmLabel}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="tw:text-current"
              onClick={request.onDecline}
              disabled={isLoading}
            >
              <RiCloseLine /> Отклонить
            </Button>
          </span>
        ) : (
          <span className="tw:ms-auto tw:text-sm tw:font-normal">
            {request.waiting}
          </span>
        )}
      </AlertTitle>
    </Alert>
  );
};

export default PendingRequestAlert;
