import SwitchField from "@/components/app/SwitchField";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import { nameOf } from "./shared";
export const operationLabels = {
  start: "Запустить",
  reboot: "Перезагрузить",
  shutdown: "Выключить (Shutdown)",
  stop: "Принудительно остановить (Stop)",
  backup: "Создать резервную копию",
};
export const primaryPowerAction = (item) =>
  item.status === "stopped" ? "start" : "reboot";
export const powerDisabledReason = (item, active = false) =>
  active || item.currentOperation?.active
    ? "Дождитесь завершения или проверьте текущую операцию в журнале ВМ"
    : item.template
      ? "Шаблон нельзя запускать или выключать"
      : item.archived || item.missingSince
        ? "Ресурс недоступен"
        : item.freshness !== "fresh"
          ? "Дождитесь свежих данных мониторинга"
          : !["running", "stopped"].includes(item.status)
            ? "Состояние ВМ не определено"
            : null;
export default function VmOperationDialog({
  operation,
  item,
  overruleShutdown = false,
  onOverruleShutdownChange,
  overrideDisabled = false,
  children,
  ...props
}) {
  const context = `Компания ВМ: ${nameOf(item.company)}. Узел: ${item.node ? nameOf(item.node) : item.nodeName || "—"}.`;
  const description =
    operation === "stop"
      ? `${context} Питание ВМ будет отключено без завершения работы гостевой ОС. Несохранённые данные могут быть потеряны; файловая система и приложения могут быть повреждены. Используйте, только если обычное выключение не помогает.`
      : `${context}${operation === "shutdown" ? " Гостевой ОС будет отправлена команда корректного завершения работы. Работа сервисов будет прервана." : operation === "reboot" ? " Гостевая ОС будет перезагружена. Работа сервисов внутри ВМ будет прервана." : ""}`;
  return (
    <ConfirmDialog
      {...props}
      title={`${operationLabels[operation] || "Операция"}: ${nameOf(item)}`}
      description={description}
      confirmLabel={operationLabels[operation] || "Выполнить"}
      confirmVariant={operation === "stop" ? "destructive" : "default"}
    >
      {operation === "stop" && (
        <SwitchField
          id="proxmox-override-shutdown"
          label="Прервать Shutdown (Override shutdown)"
          hint="Прервать выполняющееся корректное выключение в Proxmox перед Stop. Если Shutdown запущен здесь, сначала отмените операцию и дождитесь подтверждения остановки."
          checked={overruleShutdown}
          disabled={overrideDisabled || props.isLoading}
          onCheckedChange={onOverruleShutdownChange}
        />
      )}
      {children}
    </ConfirmDialog>
  );
}
