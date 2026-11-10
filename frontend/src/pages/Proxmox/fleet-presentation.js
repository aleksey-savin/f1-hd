import { cveAlertCount } from "./guest-security-presentation.js";
export const fleetStates = [
  { value: "down", label: "Недоступны" },
  { value: "unknown", label: "Нет свежих данных" },
  { value: "up", label: "Работают" },
  { value: "stopped", label: "Остановлены" },
  { value: "template", label: "Шаблоны" },
  { value: "disabled", label: "Мониторинг выключен" },
];
export const fleetState = (item) =>
  item.monitoringState ||
  (item.monitoringEnabled === false || item.monitoringPausedByConnection
    ? "disabled"
    : item.freshness !== "fresh"
      ? "unknown"
      : item.template
        ? "template"
        : ["running", "online"].includes(item.status)
          ? "up"
          : item.status === "stopped"
            ? "stopped"
            : "down");
export const nodeFindingCount = cveAlertCount;
export const nodeUpdateCount = (report) =>
  report?.updatesCount ?? report?.updates?.length ?? 0;
export const nodeNeedsAttention = (report) =>
  Boolean(
    report &&
      (report.lifecycle?.unsupported ||
        nodeFindingCount(report) ||
        nodeUpdateCount(report)),
  );
export const shouldClearBulkSelection = (result) =>
  result?.intent === "bulkCompany" && !result.error;
export const nodeSecurityProgress = (report) => {
  if (["queued", "checking"].includes(report?.status))
    return "Проверяем CVE и обновления";
  if (report?.status === "unavailable") return "Проверка недоступна";
  if (report?.status === "error") return "Не удалось обновить проверку";
  return report?.checkedAt ? null : "CVE и обновления ещё не проверены";
};
