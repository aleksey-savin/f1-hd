import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PendingAbsence } from "@/types/teamSchedule";

import { fullName } from "./calendar";

type Props = {
  request: PendingAbsence | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (comment: string) => Promise<void>;
};

/**
 * Отклонение запроса на отсутствие. Диалог, а не шторка: это единичный вопрос
 * («почему нельзя»), а ответ уходит заявителю уведомлением — поэтому причину
 * спрашиваем, а не отклоняем молча.
 */
const RejectDialog = ({ request, open, onOpenChange, onConfirm }: Props) => {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setComment("");
    }
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(comment);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Отклонить запрос</AlertDialogTitle>
          <AlertDialogDescription>
            {request ? fullName(request.user) : ""}
            {request ? ` — ${request.typeLabel.toLowerCase()}` : ""}. Причина уйдёт
            заявителю уведомлением.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="tw:mt-1">
          <Label
            htmlFor="reject-reason"
            className="tw:mb-1.5 tw:text-sm tw:font-semibold"
          >
            Причина
          </Label>
          <Textarea
            id="reject-reason"
            value={comment}
            maxLength={300}
            placeholder="Например: на эти даты уже согласован отпуск у второго инженера"
            onChange={(event) => setComment(event.target.value)}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            Отклонить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default RejectDialog;
