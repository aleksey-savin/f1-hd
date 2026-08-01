import { RiFocus3Line, RiMapPin2Line, RiStarFill } from "react-icons/ri";

import { cn } from "@/lib/utils";

import {
  DEVICE_STATUS_META,
  DeviceStatusText,
  deviceIcon,
  mikrotikStatus,
} from "./device-status";

// Плитка устройства в окружении: плитка-иконка, имя (+★ личного), тип · вендор,
// статусы текстом с точкой. highlightId — устройство заявки (режим окружения по
// устройству): бирюзовое кольцо + прицел, короткий пульс при появлении.
const EnvironmentDeviceTile = ({
  device,
  highlightId = null,
  showLocation = false,
  onSelect,
}) => {
  const Icon = deviceIcon(device.typeName);
  const status = DEVICE_STATUS_META[device.status];
  const mikro = mikrotikStatus(device);
  const isTarget = highlightId && String(device._id) === String(highlightId);

  return (
    <button
      type="button"
      onClick={() => onSelect?.(device)}
      title={
        isTarget
          ? "Устройство, о котором создана заявка"
          : "Открыть карточку устройства"
      }
      className={cn(
        "flex min-w-0 cursor-pointer appearance-none items-start gap-2.5 rounded-lg border border-border-soft bg-background p-3 text-left transition-colors hover:border-input hover:bg-accent",
        isTarget && "border-primary/60 ring-2 ring-primary/35 env-aim",
      )}
    >
      <span
        aria-hidden
        className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border"
      >
        <Icon size={17} />
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
          {isTarget && (
            <RiFocus3Line
              size={14}
              className="flex-none text-accent-text"
              title="Заявка об этом устройстве"
            />
          )}
        </span>
        {(device.typeName || device.vendorName) && (
          <span className="block truncate text-xs text-muted-foreground">
            {[device.typeName, device.vendorName].filter(Boolean).join(" · ")}
          </span>
        )}
        {showLocation && device.locationName && (
          <span className="flex items-center gap-1 text-xs text-faint">
            <RiMapPin2Line size={12} className="flex-none" />
            <span className="truncate">{device.locationName}</span>
          </span>
        )}
        {(status || mikro) && (
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            {status && (
              <DeviceStatusText tone={status.tone}>
                {status.label}
              </DeviceStatusText>
            )}
            {mikro && (
              <DeviceStatusText tone={mikro.tone}>
                {mikro.label}
              </DeviceStatusText>
            )}
          </span>
        )}
      </span>
    </button>
  );
};

export default EnvironmentDeviceTile;
