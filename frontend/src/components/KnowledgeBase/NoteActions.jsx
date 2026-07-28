import {
  RiEditLine,
  RiSaveLine,
  RiShieldCheckLine,
  RiDeleteBinLine,
  RiArchiveLine,
  RiInboxUnarchiveLine,
  RiMoreLine,
} from "react-icons/ri";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

// Действия над заметкой. Ровно одна залитая кнопка — та, которую от пользователя
// ждут прямо сейчас (модератору непроверенной заметки — «Проверить», остальным —
// «Редактировать»). Редкое и опасное живёт в icon-only меню «⋯»; безликой
// подписи «Действия» нет. Решения по чужим запросам (подтвердить/отклонить
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
      <>
        <Button variant="outline" onClick={onCancel} disabled={isLoading}>
          Отмена
        </Button>
        <Button onClick={onSave} disabled={isLoading}>
          <RiSaveLine /> Сохранить
        </Button>
      </>
    );
  }

  if (isNew || !note) {
    return null;
  }

  // Архивная заметка живёт по одному правилу: сначала восстанови, потом правь.
  if (note.archivedAt) {
    return canManage ? (
      <Button onClick={onUnarchive} disabled={isLoading}>
        <RiInboxUnarchiveLine /> Восстановить
      </Button>
    ) : null;
  }

  const needsVerification = isModerator && note.approved !== true;
  const showMenu = canManage && (!note.pendingArchive || !note.pendingDeletion);

  return (
    <>
      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              title="Ещё действия"
              aria-label="Ещё действия"
            >
              <RiMoreLine />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Жизненный цикл</DropdownMenuLabel>
            {!note.pendingArchive && (
              <DropdownMenuItem onSelect={onRequestArchive}>
                <RiArchiveLine /> Запросить архивацию
              </DropdownMenuItem>
            )}
            {!note.pendingDeletion && (
              <DropdownMenuItem variant="destructive" onSelect={onSendToDeletion}>
                <RiDeleteBinLine /> Отправить на удаление
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {canManage && (
        <Button
          variant={needsVerification ? "outline" : "default"}
          onClick={onEdit}
          disabled={isLoading}
        >
          <RiEditLine /> Редактировать
        </Button>
      )}
      {needsVerification && (
        <Button onClick={onVerify} disabled={isLoading}>
          <RiShieldCheckLine /> Проверить
        </Button>
      )}
    </>
  );
};

export default NoteActions;
