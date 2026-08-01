import { RiDeleteBinLine } from "react-icons/ri";

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

// Диалог подтверждения удаления для действий вне router-actions (раздел
// мониторинга работает прямыми fetch-вызовами стора): как app/DeleteItem, но с
// onConfirm-обработчиком вместо RouterForm. Рендерить ВНЕ radix-меню.
const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Удалить",
  onConfirm,
  isLoading = false,
}) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>
          {description || "Вы уверены? Это действие нельзя отменить."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="mt-4">
        <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
        <Button
          variant="destructive"
          type="button"
          disabled={isLoading}
          onClick={onConfirm}
        >
          <RiDeleteBinLine /> {isLoading ? "Удаление…" : confirmLabel}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default ConfirmDialog;
