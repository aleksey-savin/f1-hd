import { Form as RouterForm } from "react-router";
import { RiUserFollowLine, RiUserUnfollowLine } from "react-icons/ri";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Включить/отключить пользователя (для менеджеров). Шлёт intent=toggle-active на
// action карточки (viewUserAction → redirect на карточку, состояние обновится).
// Диалог закрываем на сабмите — иначе модальный radix оставляет залипший
// pointer-events при редиректе.
const ToggleActiveDialog = ({ user, open, onOpenChange }) => {
  // `banned` вместо `isActive`: полярность обратная, отсутствие поля = работает
  const isActive = !user.banned;
  const Icon = isActive ? RiUserUnfollowLine : RiUserFollowLine;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <RouterForm method="post" onSubmit={() => onOpenChange(false)}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isActive ? "Отключить пользователя?" : "Включить пользователя?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isActive
                ? "Открытые сеансы завершатся сразу — на всех устройствах."
                : "Доступ к системе будет восстановлен."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="id" value={user._id} readOnly />
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
            <Button
              variant={isActive ? "warning" : "success"}
              type="submit"
              name="intent"
              value="toggle-active"
            >
              <Icon /> {isActive ? "Отключить" : "Включить"}
            </Button>
          </AlertDialogFooter>
        </RouterForm>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ToggleActiveDialog;
