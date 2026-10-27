import { RiStarFill } from "react-icons/ri";

import { cn } from "@/lib/utils";

import EnvironmentDeviceMeta from "./EnvironmentDeviceMeta";
import {
  DEVICE_STATUS_META,
  DeviceStatusText,
  deviceIcon,
  mikrotikStatus,
} from "./device-status";

// Строка устройства в окружении-списке (пара к EnvironmentDeviceTile плана):
// иконка, имя (+★ личного), подстрока EnvironmentDeviceMeta, статусы текстом
// справа — на телефоне под строкой. Устройство страницы (highlightId) —
// бирюзовая обводка и метка.
const EnvironmentDeviceRow = ({
  device,
  highlightId = null,
  targetLabel,
  onSelect,
}) => {
  const Icon = deviceIcon(device.typeName);
  const status = DEVICE_STATUS_META[device.status];
  const mikro = mikrotikStatus(device);
  const isTarget = highlightId && String(device._id) === String(highlightId);

  const statuses = (status || mikro) && (
    <>
      {status && (
        <DeviceStatusText tone={status.tone}>{status.label}</DeviceStatusText>
      )}
      {mikro && (
        <DeviceStatusText tone={mikro.tone}>{mikro.label}</DeviceStatusText>
      )}
    </>
  );

  return (
    <button
      type="button"
      onClick={() => onSelect?.(device)}
      title="Открыть карточку устройства"
      className={cn(
        "flex w-full min-w-0 cursor-pointer appearance-none items-center gap-3 rounded-lg border-0 bg-transparent px-2 py-2.5 text-left transition-colors hover:bg-accent",
        isTarget && "bg-primary/8 inset-ring inset-ring-primary/45",
      )}
    >
      <span
        aria-hidden
        className="grid size-8 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border"
      >
        <Icon size={16} />
      </span>
      <span className="block min-w-0 flex-1">
        <span
          className="flex items-center gap-1.5 text-sm leading-snug font-medium"
          title={device.name}
        >
          <span className="min-w-0 truncate">{device.name}</span>
          {device.isPersonal && (
            <RiStarFill
              size={13}
              className="flex-none text-warning"
              title="Закреплено лично"
            />
          )}
        </span>
        <EnvironmentDeviceMeta device={device} />
        {statuses && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 md:hidden">
            {statuses}
          </span>
        )}
      </span>
      {(isTarget || statuses) && (
        <span className="flex flex-none items-center gap-2.5">
          {isTarget && targetLabel && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-text">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-primary ring-3 ring-primary/20"
              />
              {targetLabel}
            </span>
          )}
          {statuses && (
            <span className="flex items-center gap-2.5 max-md:hidden">
              {statuses}
            </span>
          )}
        </span>
      )}
    </button>
  );
};

export default EnvironmentDeviceRow;
