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
        "tw:flex tw:min-w-0 tw:cursor-pointer tw:appearance-none tw:items-start tw:gap-2.5 tw:rounded-lg tw:border tw:border-border-soft tw:bg-background tw:p-3 tw:text-left tw:transition-colors tw:hover:border-input tw:hover:bg-accent",
        isTarget && "tw:border-primary/60 tw:ring-2 tw:ring-primary/35 tw:env-aim",
      )}
    >
      <span
        aria-hidden
        className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
      >
        <Icon size={17} />
      </span>
      <span className="tw:block tw:min-w-0 tw:flex-1">
        <span
          className="tw:flex tw:items-center tw:gap-1.5 tw:text-sm tw:leading-snug tw:font-medium"
          title={device.name}
        >
          <span className="tw:min-w-0 tw:truncate">{device.name}</span>
          {device.isPersonal && (
            <RiStarFill
              size={13}
              className="tw:flex-none tw:text-warning"
              title="Закреплено лично"
            />
          )}
          {isTarget && (
            <RiFocus3Line
              size={14}
              className="tw:flex-none tw:text-accent-text"
              title="Заявка об этом устройстве"
            />
          )}
        </span>
        {(device.typeName || device.vendorName) && (
          <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground">
            {[device.typeName, device.vendorName].filter(Boolean).join(" · ")}
          </span>
        )}
        {showLocation && device.locationName && (
          <span className="tw:flex tw:items-center tw:gap-1 tw:text-xs tw:text-faint">
            <RiMapPin2Line size={12} className="tw:flex-none" />
            <span className="tw:truncate">{device.locationName}</span>
          </span>
        )}
        {(status || mikro) && (
          <span className="tw:mt-1 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2.5 tw:gap-y-0.5">
            {status && (
              <DeviceStatusText tone={status.tone}>{status.label}</DeviceStatusText>
            )}
            {mikro && (
              <DeviceStatusText tone={mikro.tone}>{mikro.label}</DeviceStatusText>
            )}
          </span>
        )}
      </span>
    </button>
  );
};

export default EnvironmentDeviceTile;
