import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFileCopyLine,
  RiKey2Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Eyebrow, Panel } from "@/components/app/Panel";
import Field from "@/components/app/Field";
import AlertMessage from "@/components/app/AlertMessage";
import useToastStore from "@/store/toast-store";
import { formatShortDate } from "@/util/format-date";
import { cn } from "@/lib/utils";

// API-ключи компании (только для управляющих компаниями): строки с маской
// ключа, показом/копированием и статусом текстом с точкой. «Создать ключ» —
// генерация (исключение словаря действий), удаление — с подтверждением.
const maskKey = (key) =>
  key.length <= 8 ? key : `${key.slice(0, 4)}••••${key.slice(-4)}`;

const iconBtnClass =
  "grid size-8 flex-none cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors hover:bg-border-soft hover:text-foreground";

const ApiKeysSection = ({ company, id }) => {
  const fetcher = useFetcher();

  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [visibleKeys, setVisibleKeys] = useState({});
  const [deleteKey, setDeleteKey] = useState(null);

  const keys = company.apiKeys || [];
  const busy = fetcher.state !== "idle";

  const toggleVisibility = (keyId) =>
    setVisibleKeys((prev) => ({ ...prev, [keyId]: !prev[keyId] }));

  const copyKey = (key) => {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(key).then(
      () => useToastStore.getState().showToast("success", "Ключ скопирован"),
      () =>
        useToastStore.getState().showToast("danger", "Не удалось скопировать"),
    );
  };

  const openCreate = () => {
    setKeyName("");
    setCreateOpen(true);
  };

  const submitCreate = (event) => {
    event.preventDefault();
    fetcher.submit(
      { intent: "createApiKey", companyId: company._id, keyName },
      { method: "POST", action: `/companies/${company._id}` },
    );
  };

  const confirmDelete = () => {
    fetcher.submit(
      { intent: "deleteApiKey", companyId: company._id, keyId: deleteKey._id },
      { method: "POST", action: `/companies/${company._id}` },
    );
    setDeleteKey(null);
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setCreateOpen(false);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      <Eyebrow
        id={id}
        count={keys.length}
        action={
          <Button size="sm" variant="outline" onClick={openCreate}>
            <RiAddLine /> Создать ключ
          </Button>
        }
      >
        API-ключи
      </Eyebrow>
      <Panel>
        {keys.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-6 text-center">
            <RiKey2Line size={36} aria-hidden className="text-faint" />
            <div className="font-semibold">Ключей пока нет</div>
            <p className="my-0 text-sm text-muted-foreground">
              API-ключ нужен внешним интеграциям (1С, мониторинг), чтобы
              создавать заявки от имени компании.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-1"
              onClick={openCreate}
            >
              <RiAddLine /> Создать ключ
            </Button>
          </div>
        ) : (
          keys.map((apiKey) => (
            <div
              key={apiKey._id}
              className={cn(
                "group flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border-soft py-2.5 first:border-t-0 first:pt-0 last:pb-0",
              )}
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[15px] font-medium md:min-w-40 md:flex-none md:basis-48",
                  !apiKey.isActive && "text-muted-foreground",
                )}
              >
                {apiKey.name}
              </span>
              <span className="flex min-w-0 items-center gap-0.5 max-md:order-3 max-md:w-full">
                <code
                  className={cn(
                    "min-w-0 truncate rounded-md bg-accent px-2 py-0.5 font-mono text-xs text-muted-foreground",
                    !apiKey.isActive && "text-faint",
                  )}
                >
                  {visibleKeys[apiKey._id] ? apiKey.key : maskKey(apiKey.key)}
                </code>
                <button
                  type="button"
                  onClick={() => toggleVisibility(apiKey._id)}
                  title={
                    visibleKeys[apiKey._id] ? "Скрыть ключ" : "Показать ключ"
                  }
                  aria-label={
                    visibleKeys[apiKey._id] ? "Скрыть ключ" : "Показать ключ"
                  }
                  className={iconBtnClass}
                >
                  {visibleKeys[apiKey._id] ? (
                    <RiEyeOffLine size={15} />
                  ) : (
                    <RiEyeLine size={15} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => copyKey(apiKey.key)}
                  title="Скопировать"
                  aria-label="Скопировать ключ"
                  className={iconBtnClass}
                >
                  <RiFileCopyLine size={15} />
                </button>
              </span>
              <span className="ms-auto flex-none text-xs text-faint tabular-nums max-md:hidden">
                создан {formatShortDate(apiKey.createdAt) || "—"}
              </span>
              <span
                className={cn(
                  "inline-flex w-22 flex-none items-center gap-1.5 text-[13px] font-semibold",
                  apiKey.isActive ? "text-accent-text" : "text-faint",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    apiKey.isActive
                      ? "bg-primary"
                      : "bg-transparent inset-ring inset-ring-faint",
                  )}
                />
                {apiKey.isActive ? "Активен" : "Отключён"}
              </span>
              <button
                type="button"
                onClick={() => setDeleteKey(apiKey)}
                title="Удалить"
                aria-label={`Удалить ключ ${apiKey.name}`}
                className={cn(
                  iconBtnClass,
                  "opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 max-md:opacity-100",
                )}
              >
                <RiDeleteBinLine size={15} />
              </button>
            </div>
          ))
        )}
      </Panel>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Создать API-ключ</DialogTitle>
          </DialogHeader>

          {fetcher.data?.error && (
            <AlertMessage variant="danger" message={fetcher.data.error} />
          )}

          <form onSubmit={submitCreate}>
            <Field
              label="Название ключа"
              required
              hint="Например: «Мобильное приложение», «Интеграция с CRM»."
            >
              <Input
                value={keyName}
                onChange={(event) => setKeyName(event.target.value)}
                placeholder="Для чего этот ключ"
                required
              />
            </Field>

            <DialogFooter className="mt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={busy || !keyName.trim()}>
                {busy ? "Создание…" : "Создать"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteKey)}
        onOpenChange={(open) => {
          if (!open) setDeleteKey(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteKey?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              Интеграции с этим ключом перестанут работать. Это действие нельзя
              отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmDelete}>
              <RiDeleteBinLine /> Удалить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ApiKeysSection;
