import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/app/Spinner";
export const operationNames = {
  start: "Запуск ВМ",
  reboot: "Перезагрузка ВМ",
  shutdown: "Выключение ВМ (Shutdown)",
  stop: "Принудительная остановка ВМ (Stop)",
  backup: "Резервное копирование",
};
export const operationStates = {
  queued: "Команда принята",
  dispatching: "Отправляется в Proxmox",
  running: "Выполняется",
  unknown: "Требует проверки",
  succeeded: "Завершено",
  failed: "Ошибка",
  reviewed: "Проверено вручную",
  cancelled: "Отменено",
};
const descriptions = {
  queued: "Ожидаем отправки команды в Proxmox.",
  dispatching: "Отправляем команду. Повторять её не нужно.",
  running: "Команда принята Proxmox. Проверяем завершение операции.",
  unknown:
    "Команда могла выполниться. Проверьте результат в журнале операций перед новой командой.",
  succeeded: "Proxmox подтвердил завершение операции.",
  failed:
    "Операция не завершилась успешно. Проверьте причину и журнал перед повтором.",
  reviewed: "Результат ручной проверки сохранён в журнале.",
  cancelled: "Остановка операции подтверждена.",
};
export default function OperationStatus({
  operation,
  error,
  onRetry,
  journalHref,
  compact = false,
  onCancel,
}) {
  if (!operation && !error) return null;
  const stateLabel =
    operation?.cancelRequested && operation.active
      ? operation.state === "unknown"
        ? "Отмена не подтверждена · Требует проверки"
        : "Запрошена отмена"
      : operationStates[operation?.state];
  const waiting =
    !error &&
    operation?.active &&
    ["queued", "dispatching", "running"].includes(operation.state);
  if (compact)
    return (
      <span
        role="status"
        aria-live="polite"
        className={`flex min-w-0 items-center gap-1.5 text-xs ${error || operation?.state === "failed" ? "text-destructive" : operation?.state === "unknown" ? "text-warning" : operation?.state === "succeeded" ? "text-success" : "text-muted-foreground"}`}
        title={error || operation?.error || descriptions[operation?.state]}
      >
        {waiting && <Spinner size={14} className="min-h-0 shrink-0" />}
        <span className="min-w-0 whitespace-normal break-words">
          {operationNames[operation?.operation] || "Операция ВМ"} ·{" "}
          {error || stateLabel || "Состояние уточняется"}
        </span>
      </span>
    );
  return (
    <Alert
      role="status"
      aria-live="polite"
      variant={
        error || operation?.state === "failed"
          ? "destructive"
          : operation?.state === "unknown"
            ? "warning"
            : operation?.state === "succeeded"
              ? "success"
              : "info"
      }
      className="my-4"
    >
      <AlertTitle className="line-clamp-none flex items-center gap-2">
        {waiting && <Spinner size={18} className="min-h-0 shrink-0" />}
        {operation
          ? `${operationNames[operation.operation] || "Операция ВМ"} · ${stateLabel || "Состояние уточняется"}`
          : "Не удалось обновить операцию"}
      </AlertTitle>
      <AlertDescription>
        <p>
          {error ||
            operation?.error ||
            (operation?.cancelRequested && operation.active
              ? operation.state === "unknown"
                ? "Proxmox не подтвердил отмену. Проверьте задачу и состояние ВМ в журнале операций; блокировка сохранена."
                : "Ожидаем подтверждения остановки от Proxmox. Новая команда пока заблокирована."
              : descriptions[operation?.state])}
        </p>
        {waiting && !error && <p>Статус обновляется автоматически.</p>}
        <div className="flex flex-wrap items-center gap-3">
          {onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              Отменить операцию
            </Button>
          )}
          {journalHref && (
            <a className="underline" href={journalHref}>
              {operation?.state === "unknown" && !operation.upid
                ? "Проверить операцию в журнале"
                : "Журнал операций"}
            </a>
          )}
          {error && onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Повторить проверку
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
