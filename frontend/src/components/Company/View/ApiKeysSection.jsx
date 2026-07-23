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
import { cn } from "@/lib/utils";

// API-ключи компании (только для управляющих компаниями): строки с маской
// ключа, показом/копированием и статусом текстом с точкой. «Создать ключ» —
// генерация (исключение словаря действий), удаление — с подтверждением.
const fmtDate = (value) =>
  value ? new Date(value).toLocaleDateString("ru-RU") : "—";

const maskKey = (key) =>
  key.length <= 8 ? key : `${key.slice(0, 4)}••••${key.slice(-4)}`;

const iconBtnClass =
  "tw:grid tw:size-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-faint tw:transition-colors tw:hover:bg-border-soft tw:hover:text-foreground";

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
          <div className="tw:mx-auto tw:flex tw:max-w-md tw:flex-col tw:items-center tw:gap-2 tw:py-6 tw:text-center">
            <RiKey2Line size={36} aria-hidden className="tw:text-faint" />
            <div className="tw:font-semibold">Ключей пока нет</div>
            <p className="tw:my-0 tw:text-sm tw:text-muted-foreground">
              API-ключ нужен внешним интеграциям (1С, мониторинг), чтобы
              создавать заявки от имени компании.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="tw:mt-1"
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
                "tw:group tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1.5 tw:border-t tw:border-border-soft tw:py-2.5 tw:first:border-t-0 tw:first:pt-0 tw:last:pb-0",
              )}
            >
              <span
                className={cn(
                  "tw:min-w-0 tw:flex-1 tw:truncate tw:text-[15px] tw:font-medium tw:md:min-w-40 tw:md:flex-none tw:md:basis-48",
                  !apiKey.isActive && "tw:text-muted-foreground",
                )}
              >
                {apiKey.name}
              </span>
              <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-0.5 tw:max-md:order-3 tw:max-md:w-full">
                <code
                  className={cn(
                    "tw:min-w-0 tw:truncate tw:rounded-md tw:bg-accent tw:px-2 tw:py-0.5 tw:font-mono tw:text-xs tw:text-muted-foreground",
                    !apiKey.isActive && "tw:text-faint",
                  )}
                >
                  {visibleKeys[apiKey._id] ? apiKey.key : maskKey(apiKey.key)}
                </code>
                <button
                  type="button"
                  onClick={() => toggleVisibility(apiKey._id)}
                  title={visibleKeys[apiKey._id] ? "Скрыть ключ" : "Показать ключ"}
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
              <span className="tw:ms-auto tw:flex-none tw:text-xs tw:text-faint tw:tabular-nums tw:max-md:hidden">
                создан {fmtDate(apiKey.createdAt)}
              </span>
              <span
                className={cn(
                  "tw:inline-flex tw:w-22 tw:flex-none tw:items-center tw:gap-1.5 tw:text-[13px] tw:font-semibold",
                  apiKey.isActive ? "tw:text-accent-text" : "tw:text-faint",
                )}
              >
                <span
                  className={cn(
                    "tw:size-1.5 tw:rounded-full",
                    apiKey.isActive
                      ? "tw:bg-primary"
                      : "tw:bg-transparent tw:inset-ring tw:inset-ring-faint",
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
                  "tw:opacity-0 tw:group-hover:opacity-100 tw:hover:text-destructive tw:focus-visible:opacity-100 tw:max-md:opacity-100",
                )}
              >
                <RiDeleteBinLine size={15} />
              </button>
            </div>
          ))
        )}
      </Panel>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="tw:max-w-md" aria-describedby={undefined}>
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

            <DialogFooter className="tw:mt-1">
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
          <AlertDialogFooter className="tw:mt-4">
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
