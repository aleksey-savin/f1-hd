import { Link } from "react-router";
import { RiExternalLinkLine, RiFocus3Line, RiStarFill } from "react-icons/ri";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  STATUS_META,
  EnvStatusText,
  mikrotikStatus,
  deviceIcon,
} from "./EnvironmentDeviceTile";

const dash = <span className="tw:text-faint">—</span>;

// Микро-подпись + значение (как в предпросмотре расположений).
const Info = ({ label, mono, wide, children }) => (
  <div className={cn("tw:min-w-0", wide && "tw:col-span-2")}>
    <div className="tw:mb-0.5 tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-faint tw:uppercase">
      {label}
    </div>
    <div
      className={cn(
        "tw:text-sm tw:leading-relaxed tw:break-words",
        mono && "tw:font-mono tw:text-xs tw:leading-loose",
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
  const status = device ? STATUS_META[device.status] : null;
  const mikro = device ? mikrotikStatus(device) : null;

  return (
    <Sheet
      open={Boolean(device)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="tw:w-11/12 tw:max-w-md tw:gap-0">
        {device && (
          <>
            <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:px-5 tw:pt-4 tw:pb-4">
              <div className="tw:flex tw:items-center tw:gap-3 tw:pr-8">
                <span
                  aria-hidden
                  className="tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
                >
                  {Icon && <Icon size={19} />}
                </span>
                <SheetTitle className="tw:my-0 tw:text-lg tw:leading-snug tw:font-semibold tw:tracking-tight tw:break-words">
                  {device.name}
                </SheetTitle>
              </div>

              {isTarget && (
                <div className="tw:mt-4 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold tw:text-accent-text">
                  <RiFocus3Line size={15} className="tw:flex-none" />
                  Заявка об этом устройстве
                </div>
              )}
              {device.isPersonal && (
                <div
                  className={cn(
                    "tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold tw:text-warning",
                    isTarget ? "tw:mt-1.5" : "tw:mt-4",
                  )}
                >
                  <RiStarFill size={14} className="tw:flex-none" />
                  {personalLabel}
                </div>
              )}

              <div className="tw:mt-5 tw:grid tw:grid-cols-2 tw:gap-x-4 tw:gap-y-3.5">
                <Info label="Тип">{device.typeName}</Info>
                <Info label="Производитель">{device.vendorName}</Info>
                <Info label="Статус">
                  {status && (
                    <EnvStatusText tone={status.tone} className="tw:text-sm">
                      {status.label}
                    </EnvStatusText>
                  )}
                </Info>
                {mikro && (
                  <Info label="Mikrotik">
                    <EnvStatusText tone={mikro.tone} className="tw:text-sm">
                      {mikro.label}
                    </EnvStatusText>
                  </Info>
                )}
                <Info label="Инвентарный №" mono>
                  {device.inventoryNumber}
                </Info>
                <Info label="Серийный №" mono>
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

            <div className="tw:grid tw:gap-2 tw:border-t tw:border-border-soft tw:px-5 tw:py-4">
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
