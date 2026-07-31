import { useState } from "react";

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

// Массовое закрытие. Один и тот же результат выполнения сохраняется как
// комментарий и closingComment каждой заявки. Правило о работах соблюдается на
// бэкенде (а на клиенте кнопка для заявок без работ заблокирована заранее).
const CloseModal = ({ show, onHide, count, onConfirm }) => {
  const [closingComment, setClosingComment] = useState("");

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
      <DialogContent className="tw:sm:max-w-2xl">
        <form onSubmit={submitHandler}>
          <DialogHeader>
            <DialogTitle>Закрыть заявки</DialogTitle>
            <DialogDescription>
              Выбрано заявок: {count}. Результат сохранится в каждой из них.
            </DialogDescription>
          </DialogHeader>

          <div className="tw:mt-4">
            <Field label="Результат выполнения" htmlFor="bulk-closing" required>
              <Textarea
                id="bulk-closing"
                rows={4}
                required
                autoFocus
                value={closingComment}
                onChange={(event) => setClosingComment(event.target.value)}
                placeholder="Например: Добрый день! Проблема устранена."
              />
            </Field>
            <Alert variant="warning">
              <AlertDescription>
                <ul className="tw:my-0 tw:list-disc tw:ps-4">
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

          <DialogFooter className="tw:mt-4">
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
