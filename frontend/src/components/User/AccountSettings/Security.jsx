import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AlertMessage from "@/components/app/AlertMessage";
import Field from "@/components/app/Field";
import SettingRow from "@/components/app/SettingRow";
import SwitchField from "@/components/app/SwitchField";
import useToastStore from "../../../store/toast-store";

// Секция «Безопасность»: смена пароля в диалоге (2 поля + свитч — «диалог
// только для маленьких вещей»). Механика легаси сохранена: intent
// reset-password на action маршрута /users/:id.
const Security = ({ user }) => {
  const fetcher = useFetcher();
  const { showToast } = useToastStore();

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [repeatedPassword, setRepeatedPassword] = useState("");
  const [sendPassword, setSendPassword] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      showToast(
        fetcher.data.error ? "danger" : "success",
        fetcher.data.message,
      );
    }
  }, [fetcher.state, fetcher.data]);

  const openDialog = () => {
    setPassword("");
    setRepeatedPassword("");
    setSendPassword(false);
    setInvalid(false);
    setOpen(true);
  };

  const submitHandler = (event) => {
    event.preventDefault();

    if (password.trim() === "" || password !== repeatedPassword) {
      setInvalid(true);
      return;
    }

    fetcher.submit(
      {
        intent: "reset-password",
        id: user._id,
        password,
        repeatedPassword,
        sendPassword,
      },
      { method: "POST", action: `/users/${user._id}` },
    );

    setOpen(false);
  };

  return (
    <>
      <SettingRow
        title="Пароль"
        hint="Используется для входа вместе с email."
      >
        <Button type="button" variant="outline" size="sm" onClick={openDialog}>
          Сменить пароль
        </Button>
      </SettingRow>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Смена пароля</DialogTitle>
          </DialogHeader>
          <form method="post" onSubmit={submitHandler}>
            <Field label="Новый пароль" htmlFor="password" required>
              <Input
                required
                autoFocus
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="Пароль ещё раз" htmlFor="passwordRepeat" required>
              <Input
                required
                id="passwordRepeat"
                name="passwordRepeat"
                type="password"
                value={repeatedPassword}
                onChange={(e) => setRepeatedPassword(e.target.value)}
              />
            </Field>
            <SwitchField
              id="sendPassword"
              checked={sendPassword}
              onCheckedChange={() => setSendPassword((prev) => !prev)}
              label="Отправить учётные данные на email"
              hint={`Письмо с новым паролем уйдёт на ${user.email}.`}
            />
            {invalid && (
              <AlertMessage
                variant="danger"
                message="Пароли не совпадают."
                className="tw:my-2"
              />
            )}
            <DialogFooter className="tw:mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Закрыть
              </Button>
              <Button type="submit" disabled={fetcher.state !== "idle"}>
                Сменить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Security;
