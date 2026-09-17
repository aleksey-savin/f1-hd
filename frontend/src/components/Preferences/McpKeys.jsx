import { useEffect, useState } from "react";
import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiKey2Line,
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
import { SubLabel } from "@/components/app/Panel";
import SettingRow from "@/components/app/SettingRow";
import HealthRow from "@/components/app/HealthRow";
import Field from "@/components/app/Field";
import AlertMessage from "@/components/app/AlertMessage";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import IssuedKey from "@/components/app/IssuedKey";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";
import { formatAgo, formatShortDate } from "@/util/format-date";
import { agentKeysStatus, openClawConfig } from "@/util/mcp-keys";

// «Доступ ИИ-агентов» в секции «База знаний»: ключи, по которым агенты
// (OpenClaw) читают базу знаний по MCP (backend/routes/mcp.js).
//
// Создание и удаление ключа действуют сразу, в черновик настроек не входят —
// как правила ИИ и отзыв ключа PRO32; подсказка строки это называет.
// Значение ключа живёт только в состоянии окна выдачи и уходит вместе с ним.
//
// scanForSecrets — черновое значение свитча секции: строка состояния меняется
// сразу, ещё до сохранения (так же AiRules получает aiOn / feedbackOn).

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Буфер недоступен — текст виден целиком и выделяется руками.
    return false;
  }
};

const McpKeys = ({ scanForSecrets }) => {
  const showToast = useToastStore((state) => state.showToast);

  const [data, setData] = useState(null);
  const [urlCopied, setUrlCopied] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [issued, setIssued] = useState(null);
  const [configCopied, setConfigCopied] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api("/api/preferences/mcp-keys")
      .then(setData)
      .catch((error) => {
        setData({ endpoint: "", keys: [] });
        showToast("danger", error.message || "Не удалось загрузить ключи");
      });
  }, [showToast]);

  if (!data) return null;

  const { endpoint, keys } = data;
  const status = agentKeysStatus({ keys, scanForSecrets });

  const openCreate = () => {
    setName("");
    setCreateError(null);
    setIssued(null);
    setConfigCopied(false);
    setCreateOpen(true);
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api("/api/preferences/mcp-keys", {
        method: "POST",
        body: { name },
      });
      const { value, ...row } = created.key;
      setData((current) => ({
        endpoint: created.endpoint,
        keys: [row, ...current.keys],
      }));
      // Окно НЕ закрываем, а показываем значение: закрыть его раньше, чем
      // человек скопирует, значит потерять ключ навсегда.
      setIssued({ value, endpoint: created.endpoint });
    } catch (error) {
      setCreateError(error.message || "Не удалось создать ключ");
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    setDeleting(true);
    try {
      const result = await api("/api/preferences/mcp-keys/delete", {
        method: "POST",
        body: { _id: target._id },
      });
      setData((current) => ({
        ...current,
        keys: current.keys.filter((key) => key._id !== target._id),
      }));
      setDeleteTarget(null);
      showToast("success", result.message);
    } catch (error) {
      showToast("danger", error.message || "Не удалось удалить ключ");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="mt-1 border-t border-border-soft px-5 pt-4">
        <SubLabel count={keys.length || undefined} className="mb-0">
          Доступ ИИ-агентов
        </SubLabel>
      </div>

      <SettingRow
        title="Ключи для ИИ-агентов"
        hint="Агент подключается по MCP и читает только проверенные заметки без найденных секретов. Создание и удаление ключа действуют сразу, без «Сохранить»."
      >
        <Button variant="outline" size="sm" onClick={openCreate}>
          <RiAddLine /> Создать ключ
        </Button>
      </SettingRow>

      <SettingRow
        title="Адрес для агента"
        hint="Его и ключ прописывают в настройках агента."
      >
        <div className="flex max-w-full items-center gap-1 rounded-lg border border-border-soft bg-accent py-0.5 ps-2.5 pe-0.5">
          <code className="min-w-0 truncate font-mono text-xs">{endpoint}</code>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={async () => setUrlCopied(await copyText(endpoint))}
            title={urlCopied ? "Скопировано" : "Скопировать"}
            aria-label="Скопировать адрес"
          >
            {urlCopied ? (
              <RiCheckLine className="text-accent-text" />
            ) : (
              <RiFileCopyLine />
            )}
          </Button>
        </div>
      </SettingRow>

      <div className="mx-5 mt-1 mb-4 overflow-hidden rounded-lg border border-border-soft">
        {keys.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-5 text-center">
            <RiKey2Line size={32} aria-hidden className="text-faint" />
            <div className="text-sm font-semibold">Ключей пока нет</div>
            <p className="my-0 max-w-sm text-sm text-muted-foreground">
              Создайте ключ и пропишите его в настройках агента вместе с
              адресом выше.
            </p>
          </div>
        ) : (
          keys.map((key) => (
            <div
              key={key._id}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border-soft py-2 ps-3.5 pe-2 first:border-t-0"
            >
              <span className="min-w-0 truncate text-sm font-medium md:w-42 md:flex-none max-md:order-1 max-md:w-[calc(100%-2.75rem)]">
                {key.name}
              </span>
              <code className="flex-none rounded-md bg-accent px-2 py-px font-mono text-xs text-muted-foreground max-md:order-3">
                hd_mcp_…{key.keyTail}
              </code>
              <span className="text-xs text-faint tabular-nums max-md:order-5 max-md:w-full">
                создан {formatShortDate(key.createdAt)}
              </span>
              <span
                className={cn(
                  "ms-auto text-xs tabular-nums max-md:order-4",
                  key.lastUsedAt ? "text-faint" : "text-warning",
                )}
              >
                {key.lastUsedAt
                  ? `работал ${formatAgo(key.lastUsedAt)}`
                  : "не работал ни разу"}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setDeleteTarget(key)}
                title="Удалить"
                aria-label={`Удалить ключ ${key.name}`}
                className="hover:text-destructive max-md:order-2"
              >
                <RiDeleteBinLine />
              </Button>
            </div>
          ))
        )}
      </div>

      {status && (
        <HealthRow
          state={status.state}
          title={status.title}
          meta={status.state === "ok" ? formatAgo(status.at) : undefined}
          hint={status.state === "warning" ? status.hint : undefined}
        />
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setIssued(null);
        }}
      >
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {issued ? "Ключ создан" : "Создать ключ для ИИ-агента"}
            </DialogTitle>
            {issued && (
              <DialogDescription>
                Скопируйте его сейчас и пропишите в агенте. Показать ключ ещё
                раз будет нельзя — только создать новый.
              </DialogDescription>
            )}
          </DialogHeader>

          {issued ? (
            <IssuedKey
              value={issued.value}
              onDone={() => {
                setIssued(null);
                setCreateOpen(false);
                showToast("success", "Ключ создан");
              }}
            >
              <div>
                <SubLabel
                  className="mb-1.5"
                  action={
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-accent-text"
                      onClick={async () =>
                        setConfigCopied(
                          await copyText(
                            openClawConfig(issued.endpoint, issued.value),
                          ),
                        )
                      }
                    >
                      {configCopied ? <RiCheckLine /> : <RiFileCopyLine />}
                      {configCopied ? "Скопировано" : "Скопировать"}
                    </Button>
                  }
                >
                  Настройки OpenClaw
                </SubLabel>
                <pre className="m-0 overflow-x-auto rounded-lg border border-border-soft bg-accent px-3 py-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                  {openClawConfig(issued.endpoint, issued.value)}
                </pre>
              </div>
            </IssuedKey>
          ) : (
            <form onSubmit={submitCreate}>
              {createError && (
                <AlertMessage variant="danger" message={createError} />
              )}
              <Field
                label="Название ключа"
                htmlFor="mcp-key-name"
                required
                hint="По названию ключ узнают в списке и в журнале обращений: «OpenClaw», «Тестовый стенд»."
              >
                <Input
                  id="mcp-key-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                  autoComplete="off"
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
                <Button type="submit" disabled={creating || !name.trim()}>
                  {creating ? "Создание…" : "Создать"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        title={`Удалить ключ «${deleteTarget?.name ?? ""}»?`}
        description={`Агент, который им пользуется, сразу потеряет доступ к базе знаний. ${
          deleteTarget?.lastUsedAt
            ? `Ключ работал ${formatAgo(deleteTarget.lastUsedAt)} — похоже, он в работе.`
            : "Ключ ни разу не использовался."
        }`}
        confirmLabel="Удалить"
        confirmVariant="destructive"
        confirmIcon={<RiDeleteBinLine />}
        isLoading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
};

export default McpKeys;
