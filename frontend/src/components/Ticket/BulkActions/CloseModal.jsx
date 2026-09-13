import { useRef, useState } from "react";

import Field from "@/components/app/Field";
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
import { Textarea } from "@/components/ui/textarea";

import ClosingChips, { isTouchPointer } from "../Actions/ClosingChips";

// Массовое закрытие. Один и тот же результат выполнения сохраняется как
// комментарий и closingComment каждой заявки. Правило о работах соблюдается на
// бэкенде (а на клиенте кнопка для заявок без работ заблокирована заранее).
// Чипы — без работ (у каждой заявки свои), приветствие — по поясу организации:
// заявители у выбранных заявок разные.
const CloseModal = ({ show, onHide, count, onConfirm }) => {
  const [closingComment, setClosingComment] = useState("");
  const field = useRef(null);

  const close = () => {
    setClosingComment("");
    onHide();
  };

  const submitHandler = (event) => {
    event.preventDefault();
    onConfirm({ closingComment });
    close();
  };

  return (
    <Dialog open={show} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="sm:max-w-2xl"
        onOpenAutoFocus={(event) => isTouchPointer() && event.preventDefault()}
      >
        <form onSubmit={submitHandler}>
          <DialogHeader>
            <DialogTitle>Закрыть заявки</DialogTitle>
            <DialogDescription>
              Выбрано заявок: {count}. Результат сохранится в каждой из них.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <Field label="Результат выполнения" htmlFor="bulk-closing" required>
              <Textarea
                ref={field}
                id="bulk-closing"
                rows={4}
                required
                autoFocus={!isTouchPointer()}
                value={closingComment}
                onChange={(event) => setClosingComment(event.target.value)}
                placeholder="Например: Добрый день! Проблема устранена."
              />
              <ClosingChips
                value={closingComment}
                onChange={setClosingComment}
                fieldRef={field}
              />
            </Field>
            <Alert variant="warning">
              <AlertDescription>
                <ul className="my-0 list-disc ps-4">
                  <li>
                    Это сообщение будет отправлено инициаторам выбранных заявок.
                  </li>
                  <li>
                    Из ответственных будут удалены пользователи, не указавшие
                    работы и не имеющие разрешения их не указывать.
                  </li>
                </ul>
              </AlertDescription>
            </Alert>
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

export default CloseModal;
