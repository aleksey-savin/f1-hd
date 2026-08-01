import { RiArrowRightSLine, RiShieldFlashLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import UptimeBar from "./UptimeBar";
import {
  DeviceTile,
  STATUS_META,
  daySegments,
  formatDurationShort,
  formatUptime,
  uptimeToneClass,
} from "./meta";
import { rowStatus } from "../../store/lists/mikrotik-devices";

// Строка списка мониторинга — жёсткие колонки: устройство · хост · прошивка ·
// доступность (лента 30 дней) · статус. Клик открывает шторку-превью. На
// мобайле остаются плитка, имя+мета и статус; колонки добираются с md/lg.
const DeviceRow = ({ row, onOpen }) => {
  const status = rowStatus(row);
  const statusMeta = STATUS_META[status] || STATUS_META.offline;
  const dimmed = status === "disabled";

  const meta = [
    row.type,
    row.company?.name,
    row.model?.name,
    row.location?.name,
  ]
    .filter(Boolean)
    .join(" · ");

  const firmware = row.firmwareStatus;
  const installedVersion = firmware?.installedVersion || row.currentFirmware;

  const uptimeText = formatUptime(row.uptime30d);
  const monitoredDays = Array.isArray(row.uptimeDays)
    ? row.uptimeDays.filter((day) => day != null).length
    : null;
  const offlineFor =
    status === "offline" && row.offlineSince
      ? formatDurationShort(Date.now() - new Date(row.offlineSince).getTime())
      : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative flex w-full cursor-pointer appearance-none items-center gap-3 border-0 bg-transparent px-4 py-2.5 text-left text-foreground transition-colors before:absolute before:top-0 before:right-5 before:left-5 before:h-px before:bg-border-soft first:before:hidden hover:bg-accent/60 md:gap-4 md:px-5",
        dimmed && "opacity-60",
      )}
    >
      <DeviceTile row={row} size="sm" className="md:size-10" />

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{row.displayName}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {meta || "—"}
        </span>
      </span>

      <span className="hidden w-44 flex-none lg:block">
        <span className="block truncate font-mono text-sm">
          {row.host || <span className="text-faint">—</span>}
        </span>
        {row.jump && (
          <span className="block truncate text-xs text-faint">
            через {row.jump.name || "устройство"}
          </span>
        )}
      </span>

      <span className="hidden w-28 flex-none md:block">
        <span className="block truncate font-mono text-sm">
          {installedVersion || <span className="text-faint">—</span>}
        </span>
        {firmware?.vulnerable ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-warning">
            <RiShieldFlashLine size={12} aria-hidden />
            уязвимость
          </span>
        ) : firmware?.updateAvailable ? (
          <span className="block truncate text-xs text-faint">
            → {firmware.latestVersion}
          </span>
        ) : null}
      </span>

      <span className="hidden w-40 flex-none md:block">
        <UptimeBar
          segments={daySegments(row.uptimeDays, {
            ongoing: status === "offline",
          })}
        />
        <span
          className={cn(
            "block text-xs tabular-nums",
            uptimeToneClass(row.uptime30d),
          )}
        >
          {uptimeText || "—"}
          {uptimeText && monitoredDays != null && monitoredDays < 30 && (
            <span className="text-faint"> · {monitoredDays} дн</span>
          )}
        </span>
      </span>

      <span className="w-auto flex-none text-right md:w-32 md:text-left">
        <span
          className={cn(
            "flex items-center justify-end gap-1.5 text-sm font-semibold md:justify-start",
            statusMeta.text,
          )}
        >
          <span className={cn("size-2 rounded-full", statusMeta.dot)} />
          {statusMeta.label}
        </span>
        {offlineFor && (
          <span className="block text-xs text-muted-foreground md:ps-3.5">
            {offlineFor}
          </span>
        )}
      </span>

      <span className="hidden w-4 flex-none text-faint opacity-0 transition-opacity group-hover:opacity-100 md:block">
        <RiArrowRightSLine size={16} aria-hidden />
      </span>
    </button>
  );
};

export default DeviceRow;
