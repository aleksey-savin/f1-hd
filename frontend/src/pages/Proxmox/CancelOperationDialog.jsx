import ConfirmDialog from "@/components/app/ConfirmDialog";
import { operationNames } from "./OperationStatus";
export const canCancelOperation = (operation) =>
  Boolean(
    operation?.active &&
      !operation.cancelRequested &&
      (operation.state === "queued" ||
        (operation.upid && ["running", "unknown"].includes(operation.state))),
  );
export default function CancelOperationDialog({ operation, ...props }) {
  return (
    <ConfirmDialog
      {...props}
      title={`Отменить операцию: ${operationNames[operation?.operation] || "Операция ВМ"}`}
      description={
        operation?.state === "queued"
          ? "Команда будет удалена из очереди до отправки в Proxmox."
          : "Запросим остановку задачи Proxmox. Уже выполненные изменения не отменяются. Дождитесь подтверждения остановки; до этого новая команда заблокирована."
      }
      confirmLabel="Отменить операцию"
      confirmVariant="destructive"
      cancelLabel="Назад"
    />
  );
}
