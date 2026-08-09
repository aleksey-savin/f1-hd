import { useState } from "react";

import { Button } from "@/components/ui/button";
import SettingRow from "@/components/app/SettingRow";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import PasswordInput from "@/components/app/PasswordInput";
import Field from "@/components/app/Field";
import AlertMessage from "@/components/app/AlertMessage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TwoFactorSetup from "./TwoFactorSetup";
import { api, ApiError } from "@/lib/api";
import useToastStore from "@/store/toast-store";

/**
 * Строка «Вход по коду из приложения» в разделе «Безопасность».
 *
 * Показывается ВСЕМ, включая клиентов: второй фактор — свойство своей учётной
 * записи, а не привилегия. Но и не предлагается: подсказка объясняет, что это,
 * и не уговаривает включить.
 *
 * Выключение спрашивает пароль — иначе уведённая вкладка снимает второй фактор
 * молча, и он перестаёт быть вторым фактором.
 */
const TwoFactorRow = ({ enabled, email, onChanged }) => {
  const [setupOpen, setSetupOpen] = useState(false);
  const [offOpen, setOffOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const disable = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/two-factor/disable", {
        method: "POST",
        body: { password },
      });
      useToastStore.getState().showToast("success", "Второй фактор выключен");
      setOffOpen(false);
      setPassword("");
      onChanged?.();
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : "Неверный пароль",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingRow
        title="Вход по коду из приложения"
        hint="Второй фактор: кроме пароля понадобится шестизначный код с телефона."
        divider
      >
        <div className="flex items-center gap-2.5">
          <span
            className={
              enabled
                ? "rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-accent-text"
                : "rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-muted-foreground"
            }
          >
            {enabled ? "Включено" : "Выключено"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (enabled ? setOffOpen(true) : setSetupOpen(true))}
          >
            {enabled ? "Выключить" : "Включить"}
          </Button>
        </div>
      </SettingRow>

      <TwoFactorSetup
        email={email}
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onDone={onChanged}
      />

      <Dialog open={offOpen} onOpenChange={busy ? undefined : setOffOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Выключить вход по коду?</DialogTitle>
            <DialogDescription>
              Для входа снова будет достаточно пароля. Резервные коды перестанут
              действовать.
            </DialogDescription>
          </DialogHeader>

          {error && <AlertMessage variant="danger" message={error} />}

          <Field
            label="Текущий пароль"
            htmlFor="tf-off-password"
            required
            className="mb-0"
          >
            <PasswordInput
              id="tf-off-password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOffOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={disable}
              disabled={busy || !password}
            >
              Выключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TwoFactorRow;

/**
 * Сброс чужого второго фактора — карточка человека.
 *
 * Отдельный экспорт, а не общий компонент со строкой выше: вопросы разные.
 * Там «включить у себя», здесь «снять у другого», и единственное общее у них —
 * слово «двухфакторка».
 */
export const TwoFactorReset = ({ user, open, onOpenChange, onDone }) => {
  const [busy, setBusy] = useState(false);
  const name = `${user.lastName || ""} ${user.firstName || ""}`.trim();

  const reset = async () => {
    setBusy(true);
    try {
      await api(`/api/users/${user._id}/two-factor/reset`, { method: "POST" });
      useToastStore.getState().showToast("success", "Двухфакторка сброшена");
      onOpenChange(false);
      onDone?.();
    } catch (failure) {
      useToastStore
        .getState()
        .showToast(
          "danger",
          failure instanceof ApiError
            ? failure.message
            : "Не удалось сбросить двухфакторку",
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Сбросить двухфакторку у ${name || "пользователя"}?`}
      description="Он сможет войти по одному паролю, пока не настроит приложение заново. Резервные коды тоже перестанут действовать. Убедитесь, что просит именно он: сброс по звонку от чужого человека — самый простой способ обойти второй фактор."
      confirmLabel="Сбросить"
      confirmVariant="destructive"
      isLoading={busy}
      onConfirm={reset}
    />
  );
};
