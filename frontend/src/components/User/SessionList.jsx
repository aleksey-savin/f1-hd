import { useCallback, useEffect, useState } from "react";
import {
  RiComputerLine,
  RiSmartphoneLine,
  RiSpyLine,
  RiQuestionLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import { api, ApiError } from "@/lib/api";
import useToastStore from "@/store/toast-store";
import { formatAgo } from "@/util/format-date";

/**
 * Активные сеансы — общий блок для «Моего аккаунта» и карточки человека.
 *
 * Один компонент, потому что вопрос один и тот же: где эта учётная запись
 * сейчас открыта. Отличий два, оба приходят пропами: у себя есть «это
 * устройство» и «выйти на остальных», у чужого — «завершить все».
 *
 * Токенов здесь нет и быть не может: сервер отдаёт строкам `id`, а
 * сопоставление «id → токен» не покидает бэкенд.
 */

const DeviceIcon = ({ session }) => {
  if (session.impersonatedBy) return <RiSpyLine className="size-4" />;
  if (session.device?.mobile) return <RiSmartphoneLine className="size-4" />;
  if (session.device?.browser) return <RiComputerLine className="size-4" />;
  return <RiQuestionLine className="size-4" />;
};

const SessionList = ({ userId, self = false, canRevoke = true }) => {
  const base = self ? "/api/me/sessions" : `/api/users/${userId}/sessions`;

  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api(base);
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setError("");
    } catch (failure) {
      setSessions([]);
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Не удалось получить список сеансов",
      );
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (session) => {
    setBusy(true);
    try {
      await api(`${base}/${session.id}`, { method: "DELETE" });
      useToastStore.getState().showToast("success", "Сеанс завершён");
      await load();
    } catch (failure) {
      useToastStore
        .getState()
        .showToast(
          "danger",
          failure instanceof ApiError
            ? failure.message
            : "Не удалось завершить сеанс",
        );
    } finally {
      setBusy(false);
    }
  };

  const revokeRest = async () => {
    setBusy(true);
    try {
      const result = await api(
        self ? `${base}/revoke-others` : `${base}/revoke-all`,
        { method: "POST" },
      );
      useToastStore
        .getState()
        .showToast(
          "success",
          result.count
            ? `Завершено сеансов: ${result.count}`
            : "Других сеансов не было",
        );
      await load();
    } catch (failure) {
      useToastStore
        .getState()
        .showToast(
          "danger",
          failure instanceof ApiError
            ? failure.message
            : "Не удалось завершить сеансы",
        );
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  };

  if (sessions === null) {
    return (
      <div className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
        Загружаем сеансы…
      </div>
    );
  }

  // Своих сеансов не бывает ноль — читающий этот экран сам сидит в одном из
  // них. У чужого бывает, и это нормальное состояние, а не ошибка.
  const others = sessions.filter((session) => !session.current);

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-baseline gap-2 border-b border-border-soft px-4 py-3">
        <span className="font-semibold">Активные сеансы</span>
        <span className="tabular-nums text-faint">{sessions.length}</span>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {!error && sessions.length === 0 && (
        <div className="px-4 py-4 text-sm text-muted-foreground">
          Человек сейчас нигде не залогинен.
        </div>
      )}

      {sessions.map((session, index) => (
        <div
          key={session.id}
          className={`flex items-center gap-3 px-4 py-3 ${
            index > 0 ? "border-t border-border-soft" : ""
          }`}
        >
          <span className="grid size-8 flex-none place-items-center rounded-[9px] bg-accent text-muted-foreground inset-ring inset-ring-border">
            <DeviceIcon session={session} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">
              {session.device?.title}
            </div>
            <div className="truncate text-[13px] tabular-nums text-muted-foreground">
              {[session.ip, formatAgo(session.lastActiveAt)]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>

          <div className="flex flex-none items-center gap-2">
            {session.impersonatedBy && (
              <span className="rounded-full bg-warning/18 px-2.5 py-1 text-xs font-semibold text-warning">
                Подмена
              </span>
            )}
            {session.current ? (
              <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-accent-text">
                Это устройство
              </span>
            ) : (
              canRevoke && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => revoke(session)}
                >
                  Завершить
                </Button>
              )
            )}
          </div>
        </div>
      ))}

      {canRevoke && others.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border-soft px-4 py-3">
          <Button
            variant="outline"
            className="text-destructive"
            disabled={busy}
            onClick={() => setConfirmAll(true)}
          >
            {self ? "Выйти на всех остальных устройствах" : "Завершить все"}
          </Button>
          {self && (
            <span className="text-sm text-faint">
              Эта вкладка продолжит работать.
            </span>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={self ? "Выйти на других устройствах?" : "Завершить все сеансы?"}
        description={
          self
            ? `Завершится сеансов: ${others.length}. Эта вкладка продолжит работать.`
            : `Завершится сеансов: ${sessions.length}. Человеку придётся войти заново — учётная запись при этом остаётся включённой.`
        }
        confirmLabel="Завершить"
        onConfirm={revokeRest}
      />
    </div>
  );
};

export default SessionList;
