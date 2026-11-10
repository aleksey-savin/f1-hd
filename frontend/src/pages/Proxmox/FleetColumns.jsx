import UptimeBar from "@/components/Mikrotik/UptimeBar";
import { Status, bytes, percent } from "./shared";
import {
  nodeFindingCount,
  nodeUpdateCount,
  nodeSecurityProgress,
} from "./fleet-presentation";
import { guestAgentLabel } from "./GuestAgent";
import { cveOtherCounts } from "./guest-security-presentation";
import "./fleet.css";

export function NodeSecuritySummary({ report }) {
  if (!report)
    return (
      <span className="text-muted-foreground">
        CVE и обновления ещё не проверены
      </span>
    );
  return (
    <>
      {report.lifecycle?.unsupported && (
        <span className="block text-destructive">
          Поддержка {report.version?.split(".")[0] || "этой версии"}.x завершена
        </span>
      )}
      {nodeFindingCount(report) > 0 && (
        <span className="block text-destructive">
          CVE: {nodeFindingCount(report)}
        </span>
      )}
      {cveOtherCounts(report) && (
        <span className="block text-muted-foreground">
          {cveOtherCounts(report)}
        </span>
      )}
      {nodeUpdateCount(report) > 0 && (
        <span className="block text-warning-text">
          Обновить пакетов: {nodeUpdateCount(report)}
        </span>
      )}
      {nodeSecurityProgress(report) && (
        <span className="block text-muted-foreground">
          {nodeSecurityProgress(report)}
        </span>
      )}
      {report.checkedAt &&
        !nodeFindingCount(report) &&
        !nodeUpdateCount(report) && (
          <span className="block text-muted-foreground">
            Проверка по бюллетеням Proxmox
          </span>
        )}
    </>
  );
}
export default function FleetColumns({ item, kind }) {
  const guest = kind === "guests",
    data = item.availability;
  return (
    <div
      className={`proxmox-fleet-columns ${guest ? "proxmox-guests" : "proxmox-nodes"}`}
    >
      <div className="proxmox-capacity text-sm text-muted-foreground">
        {item.resources?.cpu ?? "—"} {guest ? "vCPU" : "CPU"} ·{" "}
        {bytes(item.resources?.memory)} RAM
        <span className="mt-1 block text-xs text-faint">
          {guest
            ? item.guestOs?.name || "ОС не определена"
            : `Proxmox VE ${item.version || "—"}`}
        </span>
        {!guest &&
          nodeUpdateCount(item.nodeSecurity) > 0 &&
          item.nodeSecurity.latestVersion && (
            <span className="mt-1 block text-xs text-warning-text">
              Обновить до {item.nodeSecurity.latestVersion}
            </span>
          )}
      </div>
      <div className="text-xs">
        {guest ? (
          <span
            className={
              ["disabled", "restartRequired"].includes(item.guestAgent?.state)
                ? "text-warning-text"
                : "text-muted-foreground"
            }
          >
            {guestAgentLabel(item)}
          </span>
        ) : (
          <NodeSecuritySummary report={item.nodeSecurity} />
        )}
      </div>
      <div className="min-w-0">
        <span className="text-sm tabular-nums">
          {percent(data?.availability)}
        </span>
        <UptimeBar segments={data?.segments} className="mt-1" />
        <span className="text-xs text-faint">
          {data?.coverage == null
            ? "Не учитывается"
            : `наблюдения ${percent(data.coverage)}`}
        </span>
      </div>
      <div className="proxmox-state">
        <Status item={item} kind={kind} />
      </div>
    </div>
  );
}
export function FleetHeader({ kind, hasActions }) {
  return (
    <div className="hidden items-center gap-4 border-b border-border-soft px-5 py-3 text-xs text-faint md:flex">
      <span className="size-12 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 md:max-w-lg">
        {kind === "guests" ? "Виртуальная машина" : "Узел"}
      </span>
      <div
        className={`proxmox-fleet-columns ${kind === "guests" ? "proxmox-guests" : "proxmox-nodes"}`}
      >
        <span className="proxmox-capacity">Ресурсы</span>
        <span>{kind === "guests" ? "Агент" : "Безопасность и обновления"}</span>
        <span>Доступность · 30 дней</span>
        <span className="proxmox-state">Состояние</span>
      </div>
      {hasActions && <span className="w-14 shrink-0" aria-hidden />}
    </div>
  );
}
