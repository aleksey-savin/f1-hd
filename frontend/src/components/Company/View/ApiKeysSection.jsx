import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiKey2Line,
  RiRefreshLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatShortDate, formatAgo } from "@/util/format-date";
import { cn } from "@/lib/utils";

/**
 * API-ключи компании.
 *
 * ЗНАЧЕНИЕ КЛЮЧА ПОКАЗЫВАЕТСЯ ОДИН РАЗ — при выдаче. В базе лежит отпечаток, и
 * прочитать выданный ключ не может никто, включая администратора: раньше он
 * хранился строкой, и любая выгрузка базы давала готовый доступ на заведение
 * заявок от имени компании.
 *
 * Отсюда весь вид строки. Показывать нечего, поэтому вместо глаза и копирования
 * — хвост из четырёх знаков (сверить с тем, что прописано в интеграции) и
 * «когда работал»: когда значение недоступно, это единственный способ отличить
 * живой ключ от забытого.
 */

const iconBtnClass =
  "grid size-8 flex-none cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors hover:bg-border-soft hover:text-foreground";

/** Как ключ выглядит в списке: префикс, многоточие, хвост. */
const shortKey = (apiKey) =>
  apiKey.keyTail ? `hd_…${apiKey.keyTail}` : "hd_…";

const usageLabel = (apiKey) =>
  apiKey.lastUsedAt ? `работал ${formatAgo(apiKey.lastUsedAt)}` : "не работал ни разу";

/**
 * Единственный показ значения — общий для выдачи и перевыпуска: вопрос один и
 * тот же, «скопируйте сейчас, второго раза не будет».
 */
const IssuedKey = ({ value, onDone }) => {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <>
      <div className="flex items-stretch overflow-hidden rounded-lg border border-border">
        <div className="min-w-0 flex-1 bg-accent/55 px-3 py-2.5 font-mono text-[13px] break-all">
          {value}
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              // Буфер недоступен — ключ виден целиком и выделяется руками.
            }
          }}
          className="flex flex-none cursor-pointer appearance-none items-center gap-1.5 border-0 border-l border-border bg-card px-3.5 text-sm font-semibold text-accent-text"
        >
          {copied ? <RiCheckLine /> : <RiFileCopyLine />}
          {copied ? "Скопировано" : "Скопировать"}
        </button>
      </div>

      <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
        Мы храним не сам ключ, а его отпечаток. Даже выгрузка базы не даст
        рабочего значения — но и восстановить его мы не сможем.
      </div>

      {/* Та же галочка, что у резервных кодов второго фактора, и по той же
          причине: «Готово» без подтверждения нажимают не читая. */}
      <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-0.5 size-4"
        />
        Я скопировал ключ
      </label>

      <DialogFooter>
        <Button onClick={onDone} disabled={!saved}>
          Готово
        </Button>
      </DialogFooter>
    </>
  );
};

const ApiKeysSection = ({ company, id }) => {
  const fetcher = useFetcher();

  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [deleteKey, setDeleteKey] = useState(null);
  const [reissueKey, setReissueKey] = useState(null);
  // Значение живёт только в памяти вкладки и только до закрытия окна.
  const [issued, setIssued] = useState(null);

  const keys = company.apiKeys || [];
  const busy = fetcher.state !== "idle";
  const forgotten = keys.filter((item) => item.isActive && !item.lastUsedAt);

  const openCreate = () => {
    setKeyName("");
    setIssued(null);
    setCreateOpen(true);
  };

  const submitCreate = (event) => {
    event.preventDefault();
    fetcher.submit(
      { intent: "createApiKey", companyId: company._id, keyName },
      { method: "POST", action: `/companies/${company._id}` },
    );
  };

  const confirmReissue = () => {
    fetcher.submit(
      {
        intent: "reissueApiKey",
        companyId: company._id,
        keyId: reissueKey._id,
      },
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
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data.error) return;

    // Ключ приехал — окно НЕ закрываем, а показываем значение: закрыть его
    // раньше, чем человек скопирует, значит потерять ключ навсегда.
    if (fetcher.data.apiKey?.key) {
      setIssued(fetcher.data.apiKey.key);
      setCreateOpen(true);
      setReissueKey(null);
      return;
    }
    setCreateOpen(false);
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

      {/* Ключ, которым ни разу не воспользовались, — открытая дверь, за которой
          никто не следит. Плашка появляется только при таком ключе. */}
      {forgotten.length > 0 && (
        <div className="mb-3 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm">
          <strong>
            {forgotten.length === 1
              ? `Ключ «${forgotten[0].name}» не использовался ни разу.`
              : `${forgotten.length} ключа не использовались ни разу.`}
          </strong>{" "}
          Если интеграцию так и не настроили — удалите: неиспользуемый ключ это
          открытая дверь, за которой никто не следит.
        </div>
      )}

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
              className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border-soft py-2.5 first:border-t-0 first:pt-0 last:pb-0"
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[15px] font-medium md:min-w-40 md:flex-none md:basis-48",
                  !apiKey.isActive && "text-muted-foreground",
                )}
              >
                {apiKey.name}
              </span>

              <code className="flex-none rounded-md bg-accent px-2 py-0.5 font-mono text-xs text-muted-foreground">
                {shortKey(apiKey)}
              </code>

              <span className="text-xs text-faint tabular-nums max-md:order-3">
                создан {formatShortDate(apiKey.createdAt) || "—"}
              </span>

              <span
                className={cn(
                  "ms-auto flex-none text-xs tabular-nums",
                  apiKey.lastUsedAt ? "text-faint" : "text-warning",
                )}
              >
                {usageLabel(apiKey)}
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

              <span className="flex flex-none items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setReissueKey(apiKey)}
                  title="Перевыпустить"
                  aria-label={`Перевыпустить ключ ${apiKey.name}`}
                  className={iconBtnClass}
                >
                  <RiRefreshLine size={15} />
                </button>
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
              </span>
            </div>
          ))
        )}
      </Panel>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setIssued(null);
        }}
      >
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{issued ? "Ключ создан" : "Создать API-ключ"}</DialogTitle>
            {issued && (
              <DialogDescription>
                Скопируйте его сейчас и пропишите в интеграции. Повторно
                показать ключ будет нельзя — только выпустить новый.
              </DialogDescription>
            )}
          </DialogHeader>

          {fetcher.data?.error && (
            <AlertMessage variant="danger" message={fetcher.data.error} />
          )}

          {issued ? (
            <IssuedKey
              value={issued}
              onDone={() => {
                setIssued(null);
                setCreateOpen(false);
                useToastStore.getState().showToast("success", "Ключ создан");
              }}
            />
          ) : (
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
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(reissueKey)}
        onOpenChange={(open) => {
          if (!open) setReissueKey(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Перевыпустить ключ «{reissueKey?.name}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Название и место в списке останутся, значение станет новым.
              Прежний ключ перестанет работать сразу — интеграцию придётся
              перенастроить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
            <Button onClick={confirmReissue} disabled={busy}>
              <RiRefreshLine /> Перевыпустить
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteKey)}
        onOpenChange={(open) => {
          if (!open) setDeleteKey(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить ключ «{deleteKey?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Интеграция, которая им пользуется, перестанет создавать заявки
              сразу.{" "}
              {deleteKey?.lastUsedAt
                ? `Ключ работал ${formatAgo(deleteKey.lastUsedAt)} — похоже, он живой.`
                : "Ключ ни разу не использовался."}
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
