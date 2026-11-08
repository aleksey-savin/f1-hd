import type { ReactNode } from "react";

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

// Подтверждение действия, которое НЕ идёт через router-action (у удаления
// сущности для этого есть app/DeleteItem с RouterForm). Диалог — только для
// коротких вопросов: заголовок, объясняющий абзац, два ответа.
const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Продолжить",
  confirmVariant = "default",
  confirmIcon,
  cancelLabel = "Отмена",
  isLoading = false,
  onConfirm,
  children,
  confirmDisabled = false,
}: {
  children?: ReactNode;
  confirmDisabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  confirmVariant?: "default" | "destructive" | "warning" | "success";
  confirmIcon?: ReactNode;
  cancelLabel?: string;
  isLoading?: boolean;
  onConfirm: () => void;
}) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel type="button" disabled={isLoading}>
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={isLoading || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmIcon}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConfirmDialog;
