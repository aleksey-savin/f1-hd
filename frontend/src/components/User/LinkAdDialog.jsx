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
import { InsideOverlayContext } from "@/components/app/overlay-context";
import useToastStore from "@/store/toast-store";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";

// Связать/отвязать учётную запись пользователя с Active Directory. Логины берём
// из логов активности компании (уникальные по GUID, ещё не привязанные). Шлём
// на action компании (linkUserToAD / unlinkUserFromAD) — как легаси. UI/Select
// внутри radix-диалога работает через InsideOverlayContext (инлайн-меню).
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
        const { token } = getLocalStorageData();
        const response = await fetch(
          `${API}/api/companies/${companyId}/logs?page=1&limit=1000`,
          { headers: { Authorization: "Bearer " + token } },
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
    if (wasActive && fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
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
        <InsideOverlayContext.Provider value={true}>
          <DialogHeader>
            <DialogTitle>
              {isLinked ? "Отвязать от Active Directory" : "Связать с Active Directory"}
            </DialogTitle>
            <DialogDescription>
              {user.lastName} {user.firstName}
              {user.email ? ` · ${user.email}` : ""}
            </DialogDescription>
          </DialogHeader>

          {fetcher.data?.error && (
            <p className="tw:my-0 tw:text-sm tw:text-destructive">
              {fetcher.data.message || "Не удалось выполнить действие"}
            </p>
          )}

          {isLinked ? (
            <div className="tw:flex tw:flex-col tw:gap-2 tw:text-sm">
              <p className="tw:my-0 tw:text-muted-foreground">
                Записи логов с этим GUID перестанут быть привязаны к пользователю.
              </p>
              <code className="tw:rounded-md tw:border tw:border-border tw:bg-accent tw:px-2.5 tw:py-1.5 tw:font-mono tw:text-xs tw:break-all tw:text-muted-foreground">
                {user.activeDirectoryObjectGUID}
              </code>
            </div>
          ) : (
            <div>
              <Select
                placeholder={
                  loading
                    ? "Загрузка…"
                    : logins.length
                      ? "Выберите AD-логин"
                      : "Нет доступных AD-логинов"
                }
                isClearable
                isSearchable
                isDisabled={loading || logins.length === 0}
                options={logins}
                getOptionLabel={(option) =>
                  `${option.firstName || ""} ${option.lastName || ""} (${option.activeDirectoryLogin})`.trim()
                }
                getOptionValue={(option) => option.activeDirectoryObjectGUID}
                value={selected}
                onChange={setSelected}
              />
              <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">
                После связывания записи логов с этим GUID привяжутся к пользователю.
              </p>
            </div>
          )}

          <DialogFooter className="tw:mt-4">
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
        </InsideOverlayContext.Provider>
      </DialogContent>
    </Dialog>
  );
};

export default LinkAdDialog;
