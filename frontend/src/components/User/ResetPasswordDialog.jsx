import { useState } from "react";
import { useFetcher } from "react-router";
import { RiSaveLine } from "react-icons/ri";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import useToastStore from "@/store/toast-store";

// Сброс пароля пользователя (для менеджеров): новый пароль + повтор + опция
// отправить учётные данные на email. Шлёт intent=reset-password на action
// маршрута карточки (viewUserAction). Закрываем оптимистично — как в легаси.
const ResetPasswordDialog = ({ user, open, onOpenChange }) => {
  const fetcher = useFetcher();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [send, setSend] = useState(false);
  const [error, setError] = useState("");

  const submit = () => {
    if (!password.trim() || password !== repeat) {
      setError("Пароли не совпадают.");
      return;
    }
    setError("");
    fetcher.submit(
      {
        intent: "reset-password",
        id: user._id,
        password,
        repeatedPassword: repeat,
        sendPassword: String(send),
      },
      { method: "post", action: `/users/${user._id}` },
    );
    setPassword("");
    setRepeat("");
    setSend(false);
    onOpenChange(false);
    useToastStore.getState().showToast("success", "Пароль изменён");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Смена пароля</DialogTitle>
          <DialogDescription>
            Новый пароль для {user.lastName} {user.firstName}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error && <p className="my-0 text-sm text-destructive">{error}</p>}
          <div className="grid gap-1.5">
            <Label
              htmlFor="rp-pass"
              className="text-sm font-semibold text-muted-foreground"
            >
              Новый пароль
            </Label>
            <Input
              id="rp-pass"
              type="password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label
              htmlFor="rp-repeat"
              className="text-sm font-semibold text-muted-foreground"
            >
              Пароль ещё раз
            </Label>
            <Input
              id="rp-repeat"
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
            <Switch
              checked={send}
              onCheckedChange={(value) => setSend(!!value)}
            />
            Отправить учётные данные на email
          </label>
        </div>
        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Отмена
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={fetcher.state !== "idle"}>
            <RiSaveLine /> Сбросить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ResetPasswordDialog;
