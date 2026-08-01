import { useState } from "react";

import SwitchField from "@/components/app/SwitchField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Массовое «Принять в работу». Переключатель «Взять на себя» применяется ко всем
// выбранным заявкам: на бэкенде для каждой заявки текущий пользователь становится
// единственным ответственным (а у заявок без ответственных он добавляется в любом
// случае).
const TakeToWorkModal = ({ show, onHide, count, onConfirm }) => {
  const [takeOver, setTakeOver] = useState(false);

  const close = () => {
    setTakeOver(false);
    onHide();
  };

  const submitHandler = (event) => {
    event.preventDefault();
    onConfirm({ takeOver });
    close();
  };

  return (
    <Dialog open={show} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <form onSubmit={submitHandler}>
          <DialogHeader>
            <DialogTitle>Принять в работу</DialogTitle>
            <DialogDescription>
              Выбрано заявок: {count}. Вы станете ответственным по каждой из
              них.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2">
            <SwitchField
              id="bulk-take-over"
              label="Взять на себя"
              checked={takeOver}
              onCheckedChange={setTakeOver}
            />
            {takeOver && (
              <Alert variant="warning">
                <AlertDescription>
                  После сохранения вы останетесь единственным ответственным по
                  выбранным заявкам.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={close}>
              Отмена
            </Button>
            <Button type="submit">Сохранить</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TakeToWorkModal;
