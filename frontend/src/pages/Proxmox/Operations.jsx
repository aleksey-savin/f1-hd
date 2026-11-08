import CancelOperationDialog, {
  canCancelOperation,
} from "./CancelOperationDialog";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { ROOT } from "./data";
import { useCan } from "@/store/authed-user";
import { Button } from "@/components/ui/button";
import OperationStatus, {
  operationNames as labels,
  operationStates as states,
} from "./OperationStatus";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import { Section, Feedback, TextField, date, idOf } from "./shared";
export default function Operations({
  id,
  version,
  currentOperation,
  onActiveChange,
  onStatusError,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [cancelOperation, setCancelOperation] = useState(null);
  const [review, setReview] = useState(null),
    [reason, setReason] = useState("");
  const fetcher = useFetcher(),
    history = useFetcher(),
    more = useFetcher(),
    can = useCan();
  const path = `${ROOT}/resources/${id}?section=operations`;
  const { load } = history;
  useEffect(() => {
    load(path);
    const timer = setInterval(
      () => {
        if (document.visibilityState !== "hidden") load(path);
      },
      currentOperation?.active &&
        ["queued", "dispatching", "running"].includes(currentOperation.state)
        ? 3000
        : 15000,
    );
    return () => clearInterval(timer);
  }, [
    load,
    path,
    version,
    fetcher.data,
    currentOperation?.active,
    currentOperation?.state,
  ]);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setReview(null);
      setCancelOperation(null);
    }
  }, [fetcher.state, fetcher.data]);
  useEffect(() => {
    const data = history.data;
    if (!data || data.error || data.resourceId !== id) return;
    setSnapshot((previous) => {
      const old = previous?.id === id ? previous : null;
      const rows = data.items || [];
      const seen = new Set(rows.map(idOf));
      return {
        id,
        items: old?.expanded
          ? [...rows, ...old.items.filter((row) => !seen.has(idOf(row)))]
          : rows,
        cursor: old?.expanded ? old.cursor : data.nextCursor,
        total: data.total,
        expanded: old?.expanded || false,
      };
    });
  }, [history.data, id]);
  useEffect(() => {
    const data = more.data;
    if (!data || data.error || data.resourceId !== id) return;
    setSnapshot((old) => {
      if (old?.id !== id || old.cursor !== data.requestedCursor) return old;
      const seen = new Set(old.items.map(idOf));
      return {
        ...old,
        items: [
          ...old.items,
          ...(data.items || []).filter((row) => !seen.has(idOf(row))),
        ],
        cursor: data.nextCursor,
        total: Math.max(old.total || 0, data.total || 0),
        expanded: true,
      };
    });
  }, [more.data, id]);
  const data = snapshot?.id === id ? snapshot : null;
  const items = data?.items || [];
  const cursor = data?.cursor;
  const total = data?.total || 0;
  const loading = !data && history.state !== "idle";
  const moreBusy = more.state !== "idle";
  const error = history.data?.error
    ? history.data.message
    : more.data?.error
      ? more.data.message
      : null;
  useEffect(() => {
    onStatusError?.(history.data?.error ? history.data.message : null);
  }, [history.data, onStatusError]);
  const loadMore = () =>
    more.load(`${path}&cursor=${encodeURIComponent(cursor)}`);
  const submit = (operation, extra = {}) =>
    fetcher.submit(
      { intent: "reconcileOperation", operationId: idOf(operation), ...extra },
      { method: "post", encType: "application/json" },
    );
  const newest = items[0];
  const reviewedReceipt =
    fetcher.data?.operation?.resourceId === id ? fetcher.data.operation : null;
  const receipt =
    reviewedReceipt &&
    (!currentOperation ||
      new Date(reviewedReceipt.createdAt).getTime() >=
        new Date(currentOperation.createdAt).getTime())
      ? reviewedReceipt
      : currentOperation;
  const matching = receipt && items.find((row) => idOf(row) === idOf(receipt));
  const receiptIsLatest =
    receipt &&
    (!newest ||
      idOf(receipt) === idOf(newest) ||
      new Date(receipt.createdAt).getTime() >
        new Date(newest.createdAt).getTime());
  const receiptTime = new Date(
    receipt?.updatedAt ||
      receipt?.finishedAt ||
      receipt?.lastCheckedAt ||
      receipt?.createdAt ||
      0,
  ).getTime();
  const matchingTime = new Date(
    matching?.updatedAt ||
      matching?.finishedAt ||
      matching?.lastCheckedAt ||
      matching?.createdAt ||
      0,
  ).getTime();
  const latest = receiptIsLatest
    ? matching &&
      matchingTime >= receiptTime &&
      !(receipt.active === false && matching.active)
      ? matching
      : receipt
    : newest || null;
  const active = latest?.active ? latest : null;
  useEffect(() => {
    if (data || latest) onActiveChange?.(latest);
  }, [data, latest, onActiveChange]);
  const canReview = (row) =>
    can({ proxmox: [row.operation === "backup" ? "backup" : "power"] });
  return (
    <Section title="Операции ВМ" id="operations">
      <OperationStatus
        operation={active}
        onCancel={
          canCancelOperation(active) && canReview(active)
            ? () => setCancelOperation(active)
            : undefined
        }
      />
      {active?.state === "unknown" && canReview(active) && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={fetcher.state !== "idle"}
            onClick={() => submit(active)}
          >
            Проверить в Proxmox
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={fetcher.state !== "idle"}
            onClick={() => {
              setReason("");
              setReview(active);
            }}
          >
            Завершить ручную проверку
          </Button>
        </div>
      )}
      <Feedback data={error ? { error: true, message: error } : null} />
      {error && (
        <Button variant="outline" size="sm" onClick={() => load(path)}>
          Повторить загрузку
        </Button>
      )}
      {!review && <Feedback data={fetcher.data} />}
      {loading ? (
        <p className="text-sm text-muted-foreground">Загружаем операции…</p>
      ) : !items.length && !error ? (
        <p className="text-sm text-muted-foreground">
          Операций пока не было. Здесь появятся запуск, выключение и резервное
          копирование этой ВМ.
        </p>
      ) : null}
      <div className="divide-y divide-border-soft">
        {items.map((row) => (
          <details key={idOf(row)} className="py-3 first:pt-0">
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">
                {labels[row.operation] || "Операция ВМ"}
              </span>
              <span
                className={`ml-3 text-xs ${row.state === "failed" ? "text-destructive" : row.state === "unknown" ? "text-warning" : "text-muted-foreground"}`}
              >
                {states[row.state] || "Состояние уточняется"}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {date(row.createdAt)}
              </span>
            </summary>
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <p>
                Начало: {date(row.dispatchedAt)} · Завершение:{" "}
                {date(row.finishedAt)}
              </p>
              <p>
                Узел: {row.nodeName || "—"}
                {row.storage ? ` · Хранилище: ${row.storage}` : ""}
              </p>
              {row.error && <p className="text-destructive">{row.error}</p>}
              <p className="break-all font-mono">
                UPID: {row.upid || "Не получен"}
              </p>
              {(row.log || []).map((line, index) => (
                <p key={index} className="break-words font-mono">
                  {line}
                </p>
              ))}
            </div>
          </details>
        ))}
      </div>
      {!loading && (
        <div className="flex flex-col items-center gap-1.5 border-t border-border-soft pt-3.5">
          {cursor && (
            <Button
              variant="outline"
              size="sm"
              disabled={moreBusy}
              onClick={loadMore}
            >
              {moreBusy ? "Загрузка…" : "Показать ещё"}
            </Button>
          )}
          <span className="text-xs text-faint tabular-nums">
            Показано {items.length} из {total}
          </span>
        </div>
      )}
      <CancelOperationDialog
        operation={cancelOperation}
        open={Boolean(cancelOperation)}
        onOpenChange={(open) => !open && setCancelOperation(null)}
        isLoading={fetcher.state !== "idle"}
        onConfirm={() =>
          fetcher.submit(
            {
              intent: "cancelOperation",
              resourceId: id,
              operationId: idOf(cancelOperation),
            },
            { method: "post", encType: "application/json" },
          )
        }
      >
        <Feedback data={fetcher.data} />
      </CancelOperationDialog>
      <ConfirmDialog
        open={Boolean(review)}
        onOpenChange={(open) => !open && setReview(null)}
        title="Завершить ручную проверку"
        description="Проверьте историю операций и состояние ВМ в Proxmox. Причина сохранится в журнале; после сверки можно будет выполнить новую операцию. Команда повторно не отправляется."
        confirmLabel="Зафиксировать проверку"
        confirmDisabled={
          reason.trim().length < 10 || reason.trim().length > 500
        }
        isLoading={fetcher.state !== "idle"}
        onConfirm={() =>
          submit(review, { resolve: true, reason: reason.trim() })
        }
      >
        <TextField
          label="Результат проверки"
          hint="От 10 до 500 символов: что проверили и какой результат подтвердили."
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
        <Feedback data={fetcher.data} />
      </ConfirmDialog>
    </Section>
  );
}
