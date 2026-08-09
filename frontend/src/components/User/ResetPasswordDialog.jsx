import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

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
import Field from "@/components/app/Field";
import Segmented from "@/components/app/Segmented";
import PasswordPolicyField from "@/components/app/PasswordPolicyField";
import { verdictAllows } from "@/lib/password";
import { useAuthedUser } from "@/store/authed-user";
import usePrefsStore from "@/store/prefs";
import useToastStore from "@/store/toast-store";

/**
 * Пароль пользователя: задать вручную или отправить ссылку на смену.
 *
 * Две взаимоисключающие дороги — значит переключатель и один блок под ним, а
 * не две кнопки рядом. Поля «повторите пароль» нет: его работу делает кнопка
 * показа.
 *
 * Почта выключена — вкладка со ссылкой гаснет. Погасший контрол и есть
 * сообщение, что дороги нет; абзац-предупреждение рядом был бы лишним.
 *
 * Диалог закрывается не сразу, а по ответу сервера: отказ («пароль из утечек»,
 * «учётная запись отключена») человек чинит здесь же, не теряя ввод.
 *
 * Своя карточка — особый случай: пароль себе меняют, зная текущий, поэтому
 * появляется ещё одно поле. Правило одно на всех, включая администратора: без
 * него уведённая вкладка меняет пароль и запирает хозяина снаружи.
 */
const ResetPasswordDialog = ({ user, open, onOpenChange }) => {
  const fetcher = useFetcher();
  const me = useAuthedUser();
  // Тот же флаг, что гасит «Получить пароль» на входе: notify.byEmail.isActive.
  const emailIsActive = usePrefsStore((state) => state.emailNotifications);

  const isSelf = String(me?._id) === String(user._id);

  const [mode, setMode] = useState("set");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [verdict, setVerdict] = useState({ kind: "idle" });
  const [error, setError] = useState("");
  const done = useRef("");
  // `fetcher.data` переживает закрытие диалога, поэтому без отметки «ждём
  // ответ» повторное открытие закрылось бы само на прошлом успехе.
  const awaiting = useRef(false);

  // Диалог живёт в дереве и после закрытия — чистим, чтобы следующее открытие
  // не показало пароль прошлого человека.
  useEffect(() => {
    if (!open) {
      setCurrentPassword("");
      setPassword("");
      setVerdict({ kind: "idle" });
      setError("");
      setMode("set");
      awaiting.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!awaiting.current || fetcher.state !== "idle" || !fetcher.data) return;
    awaiting.current = false;

    if (fetcher.data.error) {
      setError(fetcher.data.error);
      return;
    }

    onOpenChange(false);
    useToastStore.getState().showToast("success", done.current);
  }, [fetcher.state, fetcher.data, onOpenChange]);

  const name = `${user.lastName || ""} ${user.firstName || ""}`.trim();
  const busy = fetcher.state !== "idle";

  const submitPassword = () => {
    setError("");
    done.current = "Пароль задан";
    awaiting.current = true;
    fetcher.submit(
      {
        intent: "reset-password",
        id: user._id,
        password,
        repeatedPassword: password,
        currentPassword,
        sendPassword: "false",
      },
      { method: "post", action: `/users/${user._id}` },
    );
  };

  const submitLink = () => {
    setError("");
    done.current = "Ссылка отправлена";
    awaiting.current = true;
    fetcher.submit(
      { intent: "send-password-link", id: user._id },
      { method: "post", action: `/users/${user._id}` },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Пароль</DialogTitle>
          <DialogDescription>
            {name}
            {user.email ? ` · ${user.email}` : ""}
          </DialogDescription>
        </DialogHeader>

        <Segmented
          ariaLabel="Способ"
          value={mode}
          onChange={(next) => {
            setError("");
            setMode(next);
          }}
          options={[
            { value: "set", label: "Задать пароль" },
            {
              value: "link",
              label: "Отправить ссылку",
              disabled: !emailIsActive,
              title: emailIsActive
                ? undefined
                : "Почта в настройках выключена — письмо не уйдёт",
            },
          ]}
        />

        {mode === "set" ? (
          <div className="flex flex-col gap-3.5">
            {isSelf && (
              <Field
                label="Текущий пароль"
                htmlFor="current-password"
                className="mb-0"
              >
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
            )}
            <PasswordPolicyField
              id="reset-password"
              value={password}
              onChange={setPassword}
              onVerdictChange={setVerdict}
              autoFocus={!isSelf}
            />
            <p className="my-0 border-t border-border pt-3 text-xs text-muted-foreground">
              {isSelf
                ? "Ваши сеансы на других устройствах завершатся. Эта вкладка останется."
                : "Другие сеансы этого человека завершатся — на всех устройствах."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p className="my-0">
              <span className="font-semibold text-foreground">{name}</span>{" "}
              получит письмо со ссылкой и задаст пароль сам. Вы его не увидите и
              передавать не придётся.
            </p>
            <p className="my-0">Ссылка живёт 24 часа и срабатывает один раз.</p>
          </div>
        )}

        {error && (
          <p className="my-0 text-sm font-medium text-destructive">{error}</p>
        )}

        <DialogFooter className="mt-2 max-sm:grid max-sm:grid-cols-2">
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Отмена
            </Button>
          </DialogClose>
          {mode === "set" ? (
            <Button
              onClick={submitPassword}
              disabled={
                busy ||
                !verdictAllows(verdict) ||
                (isSelf && currentPassword.trim() === "")
              }
            >
              Задать пароль
            </Button>
          ) : (
            <Button onClick={submitLink} disabled={busy}>
              Отправить ссылку
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ResetPasswordDialog;
