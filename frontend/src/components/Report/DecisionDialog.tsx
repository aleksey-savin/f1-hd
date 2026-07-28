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
import { cn } from "@/lib/utils";

/**
 * Решение по отчёту: согласовать или отклонить.
 *
 * Диалог, а не шторка: это единичный вопрос. При отказе причина обязательна —
 * она уходит исполнителю уведомлением и остаётся в истории отчёта, поэтому
 * молча отклонить нельзя (тот же паттерн, что у отказа в отсутствии,
 * components/Team/RejectDialog).
 */
const DecisionDialog = ({
  open,
  approve,
  title,
  subtitle,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  approve: boolean;
  title: string;
  subtitle: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (comment: string) => Promise<void>;
}) => {
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {subtitle}
            {approve
              ? ". После согласования отчёт уйдёт на выставление счёта."
              : ". Причина уйдёт исполнителю уведомлением и останется в истории отчёта."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!approve && (
          <div className="tw:mt-1">
            <Label
              htmlFor="decision-reason"
              className="tw:mb-1.5 tw:text-sm tw:font-semibold"
            >
              Причина
            </Label>
            <Textarea
              id="decision-reason"
              value={comment}
              maxLength={500}
              placeholder="Например: выезд 12.07 выполнял другой подрядчик"
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || (!approve && !comment.trim())}
            // Разрушающее действие красит саму кнопку — цветом на диалоге
            // говорим ровно об одном
            className={cn(
              !approve &&
                "tw:bg-destructive tw:text-white tw:hover:bg-destructive/90",
            )}
            onClick={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            {approve ? "Согласовать" : "Отклонить"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DecisionDialog;
