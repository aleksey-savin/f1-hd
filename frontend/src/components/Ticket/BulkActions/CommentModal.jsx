import { useState } from "react";

import Field from "@/components/app/Field";
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

// Массовый комментарий: один и тот же текст добавляется к каждой выбранной заявке.
// Вложения для bulk не поддерживаем.
const CommentModal = ({ show, onHide, count, onConfirm }) => {
  const [content, setContent] = useState("");

  const close = () => {
    setContent("");
    onHide();
  };

  const submitHandler = (event) => {
    event.preventDefault();
    onConfirm({ content });
    close();
  };

  return (
    <Dialog open={show} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <form onSubmit={submitHandler}>
          <DialogHeader>
            <DialogTitle>Комментарий к заявкам</DialogTitle>
            <DialogDescription>
              Один комментарий будет добавлен ко всем выбранным заявкам.
              Выбрано: {count}.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <Field label="Комментарий" htmlFor="bulk-comment" required>
              <Textarea
                id="bulk-comment"
                rows={4}
                required
                autoFocus
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </Field>
          </div>

          <DialogFooter>
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

export default CommentModal;
