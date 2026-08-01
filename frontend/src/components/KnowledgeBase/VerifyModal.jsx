import { useState } from "react";

import { RiShieldCheckLine } from "react-icons/ri";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { plural } from "../../util/plural";

// «N заметок» с правильным окончанием — модератор проверяет и по одной, и пачкой.
const notesPlural = (count) =>
  `${count} ${plural(count, "заметку", "заметки", "заметок")}`;

// Диалог проверки заметки. Обе галочки выключены по умолчанию; «Проверить»
// активна только когда подтверждены оба условия — это и есть смысл отметки
// «Проверено»: модератор ручается за актуальность и отсутствие секретов.
// count > 1 — та же аттестация сразу для выделенных заметок.
const VerifyModal = ({
  open,
  onOpenChange,
  onConfirm,
  isLoading,
  count = 1,
}) => {
  const [confirmCurrent, setConfirmCurrent] = useState(false);
  const [confirmNoSecrets, setConfirmNoSecrets] = useState(false);

  const reset = () => {
    setConfirmCurrent(false);
    setConfirmNoSecrets(false);
  };

  const openChange = (next) => {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  };

  const subject = count > 1 ? notesPlural(count) : "эта запись";
  const verb = count > 1 ? "содержат" : "содержит";

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {count > 1 ? `Проверка: ${notesPlural(count)}` : "Проверка заметки"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Switch
              id="verify-confirm-current"
              checked={confirmCurrent}
              onCheckedChange={setConfirmCurrent}
              className="mt-0.5"
            />
            <Label
              htmlFor="verify-confirm-current"
              className="text-sm leading-snug font-normal"
            >
              Я подтверждаю, что {subject} {verb} только актуальные данные
            </Label>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              id="verify-confirm-no-secrets"
              checked={confirmNoSecrets}
              onCheckedChange={setConfirmNoSecrets}
              className="mt-0.5"
            />
            <Label
              htmlFor="verify-confirm-no-secrets"
              className="text-sm leading-snug font-normal"
            >
              Я подтверждаю, что {subject} не {verb} паролей, ключей шифрования,
              данных для активации программных продуктов и иных чувствительных
              данных
            </Label>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => openChange(false)}
            disabled={isLoading}
          >
            Отмена
          </Button>
          <Button
            onClick={() =>
              onConfirm({ confirmCurrent, confirmNoSecrets }, reset)
            }
            disabled={!confirmCurrent || !confirmNoSecrets || isLoading}
          >
            <RiShieldCheckLine /> Проверить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VerifyModal;
