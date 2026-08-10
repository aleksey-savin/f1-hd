import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { RiShieldCheckLine } from "react-icons/ri";

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
import useToastStore from "@/store/toast-store";

import Combobox, { toOptions } from "@/components/app/Combobox";

// Связать/отвязать учётную запись пользователя с Active Directory. Логины берём
// из логов активности компании (уникальные по GUID, ещё не привязанные). Шлём
// на action компании (linkUserToAD / unlinkUserFromAD) — как легаси.
const API = import.meta.env.VITE_API_ADDRESS;

const LinkAdDialog = ({ user, open, onOpenChange }) => {
  const companyId = user.company?._id;
  const isLinked = Boolean(user.activeDirectoryObjectGUID);
  const fetcher = useFetcher();

  const [logins, setLogins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!open || isLinked || !companyId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${API}/api/companies/${companyId}/logs?page=1&limit=1000`,
        );
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const seen = new Set();
        const out = [];
        for (const log of data.logs || []) {
          if (log.userId || !log.activeDirectoryObjectGUID) continue;
          if (seen.has(log.activeDirectoryObjectGUID)) continue;
          seen.add(log.activeDirectoryObjectGUID);
          out.push(log);
        }
        setLogins(out);
      } catch {
        /* тихо — покажем «нет логинов» */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isLinked, companyId]);

  // Закрываем только при реальном переходе fetcher active → idle с успехом.
  const prevState = useRef(fetcher.state);
  useEffect(() => {
    const wasActive = prevState.current !== "idle";
    prevState.current = fetcher.state;
    if (
      wasActive &&
      fetcher.state === "idle" &&
      fetcher.data &&
      !fetcher.data.error
    ) {
      onOpenChange(false);
      setSelected(null);
      useToastStore
        .getState()
        .showToast("success", isLinked ? "Отвязан от AD" : "Связан с AD");
    }
  }, [fetcher.state, fetcher.data, isLinked, onOpenChange]);

  const submit = () => {
    if (!companyId) return;
    if (isLinked) {
      fetcher.submit(
        { intent: "unlinkUserFromAD", userId: user._id },
        { method: "post", action: `/companies/${companyId}` },
      );
    } else if (selected) {
      fetcher.submit(
        {
          intent: "linkUserToAD",
          userId: user._id,
          activeDirectoryObjectGUID: selected.activeDirectoryObjectGUID,
        },
        { method: "post", action: `/companies/${companyId}` },
      );
    }
  };

  const busy = fetcher.state !== "idle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isLinked
              ? "Отвязать от Active Directory"
              : "Связать с Active Directory"}
          </DialogTitle>
          <DialogDescription>
            {user.lastName} {user.firstName}
            {user.email ? ` · ${user.email}` : ""}
          </DialogDescription>
        </DialogHeader>

        {fetcher.data?.error && (
          <p className="my-0 text-sm text-destructive">
            {fetcher.data.message || "Не удалось выполнить действие"}
          </p>
        )}

        {isLinked ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="my-0 text-muted-foreground">
              Записи логов с этим GUID перестанут быть привязаны к пользователю.
            </p>
            <code className="rounded-md border border-border bg-accent px-2.5 py-1.5 font-mono text-xs break-all text-muted-foreground">
              {user.activeDirectoryObjectGUID}
            </code>
          </div>
        ) : (
          <div>
            <Combobox
              ariaLabel="AD-логин"
              placeholder={
                loading
                  ? "Загрузка…"
                  : logins.length
                    ? "Выберите AD-логин"
                    : "Нет доступных AD-логинов"
              }
              loading={loading}
              disabled={loading || logins.length === 0}
              options={toOptions(logins, {
                value: (option) => option.activeDirectoryObjectGUID,
                label: (option) =>
                  `${option.firstName || ""} ${option.lastName || ""} (${option.activeDirectoryLogin})`.trim(),
              })}
              value={selected?.activeDirectoryObjectGUID ?? null}
              onChange={(guid) =>
                setSelected(
                  logins.find(
                    (option) => option.activeDirectoryObjectGUID === guid,
                  ) || null,
                )
              }
              clearable
              clearLabel="Не выбран"
            />
            <p className="mt-2 mb-0 text-xs text-muted-foreground">
              После связывания записи логов с этим GUID привяжутся к
              пользователю.
            </p>
          </div>
        )}

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Отмена
            </Button>
          </DialogClose>
          <Button
            variant={isLinked ? "destructive" : "default"}
            onClick={submit}
            disabled={busy || (!isLinked && !selected)}
          >
            <RiShieldCheckLine /> {isLinked ? "Отвязать" : "Связать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LinkAdDialog;
