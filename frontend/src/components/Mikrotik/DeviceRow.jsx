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

  const meta = [row.type, row.company?.name, row.model?.name, row.location?.name]
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
        "tw:group tw:relative tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-3 tw:border-0 tw:bg-transparent tw:px-4 tw:py-2.5 tw:text-left tw:text-foreground tw:transition-colors tw:before:absolute tw:before:top-0 tw:before:right-5 tw:before:left-5 tw:before:h-px tw:before:bg-border-soft tw:first:before:hidden tw:hover:bg-accent/60 tw:md:gap-4 tw:md:px-5",
        dimmed && "tw:opacity-60",
      )}
    >
      <DeviceTile row={row} size="sm" className="tw:md:size-10" />

      <span className="tw:min-w-0 tw:flex-1">
        <span className="tw:block tw:truncate tw:font-medium">
          {row.displayName}
        </span>
        <span className="tw:block tw:truncate tw:text-sm tw:text-muted-foreground">
          {meta || "—"}
        </span>
      </span>

      <span className="tw:hidden tw:w-44 tw:flex-none tw:lg:block">
        <span className="tw:block tw:truncate tw:font-mono tw:text-sm">
          {row.host || <span className="tw:text-faint">—</span>}
        </span>
        {row.jump && (
          <span className="tw:block tw:truncate tw:text-xs tw:text-faint">
            через {row.jump.name || "устройство"}
          </span>
        )}
      </span>

      <span className="tw:hidden tw:w-28 tw:flex-none tw:md:block">
        <span className="tw:block tw:truncate tw:font-mono tw:text-sm">
          {installedVersion || <span className="tw:text-faint">—</span>}
        </span>
        {firmware?.vulnerable ? (
          <span className="tw:flex tw:items-center tw:gap-1 tw:text-xs tw:font-semibold tw:text-warning">
            <RiShieldFlashLine size={12} aria-hidden />
            уязвимость
          </span>
        ) : firmware?.updateAvailable ? (
          <span className="tw:block tw:truncate tw:text-xs tw:text-faint">
            → {firmware.latestVersion}
          </span>
        ) : null}
      </span>

      <span className="tw:hidden tw:w-40 tw:flex-none tw:md:block">
        <UptimeBar
          segments={daySegments(row.uptimeDays, {
            ongoing: status === "offline",
          })}
        />
        <span
          className={cn(
            "tw:block tw:text-xs tw:tabular-nums",
            uptimeToneClass(row.uptime30d),
          )}
        >
          {uptimeText || "—"}
          {uptimeText && monitoredDays != null && monitoredDays < 30 && (
            <span className="tw:text-faint"> · {monitoredDays} дн</span>
          )}
        </span>
      </span>

      <span className="tw:w-auto tw:flex-none tw:text-right tw:md:w-32 tw:md:text-left">
        <span
          className={cn(
            "tw:flex tw:items-center tw:justify-end tw:gap-1.5 tw:text-sm tw:font-semibold tw:md:justify-start",
            statusMeta.text,
          )}
        >
          <span
            className={cn("tw:size-2 tw:rounded-full", statusMeta.dot)}
          />
          {statusMeta.label}
        </span>
        {offlineFor && (
          <span className="tw:block tw:text-xs tw:text-muted-foreground tw:md:ps-3.5">
            {offlineFor}
          </span>
        )}
      </span>

      <span className="tw:hidden tw:w-4 tw:flex-none tw:text-faint tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:md:block">
        <RiArrowRightSLine size={16} aria-hidden />
      </span>
    </button>
  );
};

export default DeviceRow;
