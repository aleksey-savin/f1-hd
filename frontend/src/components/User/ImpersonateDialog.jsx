import { useEffect, useState } from "react";
import { RiFileCopyLine, RiCheckLine } from "react-icons/ri";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import AlertMessage from "@/components/app/AlertMessage";
import { api, ApiError } from "@/lib/api";

/**
 * Вход под пользователем — ССЫЛКОЙ, а не подменой этой вкладки.
 *
 * Штатная подмена гасит cookie администратора и прячет её в отдельную; возврат
 * тогда зависит от этой спрятанной cookie, и если в чужом сеансе что-то пойдёт
 * не так, вернуться нечем. Ссылка открывается в другом браузере или в
 * инкогнито — эта вкладка всё время остаётся своей, и возвращаться не надо.
 *
 * Ссылка запрашивается ПРИ ОТКРЫТИИ диалога, а не по кнопке внутри: сеанс
 * подмены уже создан к моменту показа, и лишний шаг «получить ссылку» ничего
 * не решал бы — отменить его всё равно нельзя.
 */
const ImpersonateDialog = ({ user, open, onOpenChange }) => {
  const [state, setState] = useState({ status: "idle" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setState({ status: "idle" });
      setCopied(false);
      return;
    }

    let alive = true;
    setState({ status: "loading" });
    api(`/api/users/${user._id}/impersonate`, { method: "POST" })
      .then((data) => alive && setState({ status: "ready", data }))
      .catch((failure) => {
        if (!alive) return;
        setState({
          status: "error",
          message:
            failure instanceof ApiError
              ? failure.message
              : "Не удалось войти под пользователем",
        });
      });
    return () => {
      alive = false;
    };
  }, [open, user._id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.data.link);
      setCopied(true);
    } catch {
      // Буфер недоступен (например, страница не на https) — ссылка видна
      // целиком и выделяется руками, отдельного сообщения об этом не нужно.
    }
  };

  const name = `${user.lastName || ""} ${user.firstName || ""}`.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Войти под {name || "пользователем"}</DialogTitle>
          <DialogDescription>
            Откройте ссылку <strong>в другом браузере или в окне инкогнито</strong>.
            Здесь вы останетесь под своей учётной записью.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" && (
          <p className="my-0 text-sm text-muted-foreground">Готовим ссылку…</p>
        )}

        {state.status === "error" && (
          <AlertMessage variant="danger" message={state.message} />
        )}

        {state.status === "ready" && (
          <>
            <div className="flex items-stretch overflow-hidden rounded-lg border border-border">
              <div className="min-w-0 flex-1 truncate bg-accent/55 px-3 py-2.5 font-mono text-[13px] text-muted-foreground">
                {state.data.link}
              </div>
              <button
                type="button"
                onClick={copy}
                className="flex flex-none cursor-pointer appearance-none items-center gap-1.5 border-0 border-l border-border bg-card px-3.5 text-sm font-semibold text-accent-text"
              >
                {copied ? <RiCheckLine /> : <RiFileCopyLine />}
                {copied ? "Скопировано" : "Скопировать"}
              </button>
            </div>

            <p className="my-0 text-[13px] text-faint">
              Ссылка одноразовая и живёт 10 минут. Сеанс под чужой учётной
              записью — час, дальше он завершится сам.
            </p>

            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
              В журнале останется, кто и когда работал под этой учётной записью.
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImpersonateDialog;
