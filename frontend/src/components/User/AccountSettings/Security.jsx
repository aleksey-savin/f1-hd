import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import PasswordPolicyField from "@/components/app/PasswordPolicyField";
import SettingRow from "@/components/app/SettingRow";
import SessionList from "@/components/User/SessionList";
import TwoFactorRow from "@/components/User/TwoFactorRow";
import { verdictAllows } from "@/lib/password";
import useToastStore from "@/store/toast-store";

/**
 * Секция «Безопасность»: смена собственного пароля.
 *
 * Текущий пароль спрашиваем обязательно — иначе уведённая вкладка меняет
 * пароль молча и запирает хозяина снаружи. Поля «повторите пароль» нет: его
 * работу делает кнопка показа в PasswordPolicyField, оттуда же живая проверка
 * длины и утечек. Отправлять себе пароль письмом (прежний свитч) незачем: он
 * только что набран, а письмо превращало бы почтовый ящик в его хранилище.
 */
const Security = ({ user }) => {
  const fetcher = useFetcher();
  // Включение и выключение фактора меняет профиль — перечитываем загрузчик,
  // иначе строка осталась бы в прежнем состоянии до перезагрузки страницы.
  const revalidator = useRevalidator();

  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [verdict, setVerdict] = useState({ kind: "idle" });
  const [error, setError] = useState("");
  // `fetcher.data` переживает закрытие диалога — без отметки «ждём ответ»
  // повторное открытие закрылось бы само на прошлом успехе.
  const awaiting = useRef(false);

  useEffect(() => {
    if (!awaiting.current || fetcher.state !== "idle" || !fetcher.data) return;
    awaiting.current = false;

    if (fetcher.data.error) {
      setError(fetcher.data.error);
      return;
    }

    setOpen(false);
    useToastStore.getState().showToast("success", "Пароль изменён");
  }, [fetcher.state, fetcher.data]);

  const openDialog = () => {
    setCurrentPassword("");
    setPassword("");
    setVerdict({ kind: "idle" });
    setError("");
    awaiting.current = false;
    setOpen(true);
  };

  const submitHandler = (event) => {
    event.preventDefault();
    setError("");
    awaiting.current = true;

    fetcher.submit(
      {
        intent: "reset-password",
        id: user._id,
        password,
        repeatedPassword: password,
        currentPassword,
      },
      { method: "POST", action: `/users/${user._id}` },
    );
  };

  const busy = fetcher.state !== "idle";

  return (
    <>
      <SettingRow title="Пароль" hint="Используется для входа вместе с email.">
        <Button type="button" variant="outline" size="sm" onClick={openDialog}>
          Сменить пароль
        </Button>
      </SettingRow>

      {/* Второй фактор — всем, включая клиентов: это свойство своей учётной
          записи. Но именно СТРОКОЙ, а не приглашением: подсказка объясняет,
          что это, и не уговаривает. */}
      <TwoFactorRow
        enabled={Boolean(user.twoFactorEnabled)}
        email={user.email}
        onChanged={() => revalidator.revalidate()}
      />

      {/* Список устройств — ответ на «меня взломали?», за которым в
          «Безопасность» и приходят. Показываем всем, включая клиентов: это
          вопрос про свою учётную запись, а не про портал. */}
      <div className="mt-4">
        <SessionList self />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Смена пароля</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitHandler} className="flex flex-col gap-3.5">
            <Field
              label="Текущий пароль"
              htmlFor="current-password"
              className="mb-0"
              required
            >
              <Input
                required
                autoFocus
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </Field>

            <PasswordPolicyField
              id="new-password"
              value={password}
              onChange={setPassword}
              onVerdictChange={setVerdict}
            />

            <p className="my-0 border-t border-border pt-3 text-xs text-muted-foreground">
              Ваши сеансы на других устройствах завершатся. Эта вкладка
              останется.
            </p>

            {error && (
              <p className="my-0 text-sm font-medium text-destructive">
                {error}
              </p>
            )}

            <DialogFooter className="mt-2 max-sm:grid max-sm:grid-cols-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || !verdictAllows(verdict) || !currentPassword.trim()
                }
              >
                Сменить пароль
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Security;
