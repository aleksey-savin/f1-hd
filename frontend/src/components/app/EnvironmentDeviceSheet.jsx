import { Link } from "react-router";
import { RiExternalLinkLine, RiFocus3Line, RiStarFill } from "react-icons/ri";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  DEVICE_STATUS_META,
  DeviceStatusText,
  mikrotikStatus,
  deviceIcon,
} from "./device-status";

const dash = <span className="text-faint">—</span>;

// Микро-подпись + значение (как в предпросмотре расположений).
const Info = ({ label, mono, wide, children }) => (
  <div className={cn("min-w-0", wide && "col-span-2")}>
    <div className="mb-0.5 text-xs font-semibold tracking-wide text-faint uppercase">
      {label}
    </div>
    <div
      className={cn(
        "text-sm leading-relaxed break-words",
        mono && "font-mono text-xs leading-loose",
      )}
    >
      {children || dash}
    </div>
  </div>
);

// Шторка устройства (справа) — по образцу предпросмотра расположений: плитка +
// имя, флаги «целевое/личное», сетка микро-подписей, главное действие —
// «Открыть карточку устройства».
const EnvironmentDeviceSheet = ({
  device,
  isTarget = false,
  personalLabel = "Закреплено лично за заявителем",
  onClose,
}) => {
  const Icon = device ? deviceIcon(device.typeName) : null;
  const status = device ? DEVICE_STATUS_META[device.status] : null;
  const mikro = device ? mikrotikStatus(device) : null;

  return (
    <Sheet
      open={Boolean(device)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-11/12 max-w-md gap-0">
        {device && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4">
              <div className="flex items-center gap-3 pr-8">
                <span
                  aria-hidden
                  className="grid size-10 flex-none place-items-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border"
                >
                  {Icon && <Icon size={19} />}
                </span>
                <SheetTitle className="my-0 text-lg leading-snug font-semibold tracking-tight break-words">
                  {device.name}
                </SheetTitle>
              </div>

              {isTarget && (
                <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-accent-text">
                  <RiFocus3Line size={15} className="flex-none" />
                  Заявка об этом устройстве
                </div>
              )}
              {device.isPersonal && (
                <div
                  className={cn(
                    "flex items-center gap-2 text-sm font-semibold text-warning",
                    isTarget ? "mt-1.5" : "mt-4",
                  )}
                >
                  <RiStarFill size={14} className="flex-none" />
                  {personalLabel}
                </div>
              )}

              <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3.5">
                <Info label="Тип">{device.typeName}</Info>
                <Info label="Производитель">{device.vendorName}</Info>
                <Info label="Статус">
                  {status && (
                    <DeviceStatusText tone={status.tone} className="text-sm">
                      {status.label}
                    </DeviceStatusText>
                  )}
                </Info>
                {mikro && (
                  <Info label="Mikrotik">
                    <DeviceStatusText tone={mikro.tone} className="text-sm">
                      {mikro.label}
                    </DeviceStatusText>
                  </Info>
                )}
                <Info label="Инвентарный номер" mono>
                  {device.inventoryNumber}
                </Info>
                <Info label="Серийный номер" mono>
                  {device.serialNumber}
                </Info>
                <Info label="IP-адрес" mono>
                  {device.ipAddress}
                </Info>
                <Info label="Операционная система">
                  {device.operatingSystem}
                </Info>
                <Info label="Расположение" wide>
                  {device.locationName}
                </Info>
              </div>
            </div>

            <div className="grid gap-2 border-t border-border-soft px-5 py-4">
              <Button asChild>
                <Link to={`/inventory/client-devices/${device._id}`}>
                  <RiExternalLinkLine /> Открыть карточку устройства
                </Link>
              </Button>
              {device.mikrotikManaged && (
                <Button asChild variant="outline">
                  <Link to={`/devices/mikrotik?clientDeviceId=${device._id}`}>
                    <RiExternalLinkLine /> Открыть в мониторинге Mikrotik
                  </Link>
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default EnvironmentDeviceSheet;
