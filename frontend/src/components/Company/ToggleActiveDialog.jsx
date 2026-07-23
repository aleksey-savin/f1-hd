import { Form as RouterForm } from "react-router";
import { RiCheckboxCircleLine, RiForbid2Line } from "react-icons/ri";

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

// Включить/отключить компанию (по образцу User/ToggleActiveDialog). Шлёт
// intent=toggle-active на action карточки (redirect на карточку, состояние
// обновится). Диалог закрываем на сабмите — иначе модальный radix оставляет
// залипший pointer-events при редиректе.
const ToggleActiveDialog = ({ company, open, onOpenChange }) => {
  const isActive = company.isActive !== false;
  const Icon = isActive ? RiForbid2Line : RiCheckboxCircleLine;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <RouterForm method="post" onSubmit={() => onOpenChange(false)}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isActive ? "Отключить компанию?" : "Включить компанию?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isActive
                ? "Пользователи компании потеряют доступ к системе, почта и телефония перестанут опознавать компанию, регламентные задания будут пропускаться."
                : "Доступ пользователей компании будет восстановлен."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="id" value={company._id} readOnly />
          <AlertDialogFooter className="tw:mt-4">
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
