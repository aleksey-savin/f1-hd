import {
  RiComputerLine,
  RiFocus3Line,
  RiHardDrive2Line,
  RiHeadphoneLine,
  RiMacbookLine,
  RiMapPin2Line,
  RiPlugLine,
  RiPrinterLine,
  RiRouterLine,
  RiServerLine,
  RiSmartphoneLine,
  RiStarFill,
  RiTvLine,
} from "react-icons/ri";

import { cn } from "@/lib/utils";

// Статусы ClientDevice → подпись + тон. Показ — цветной текст с точкой
// (язык статус-борда), не заливной бейдж.
export const STATUS_META = {
  readyForDeployment: { label: "Готово к выдаче", tone: "off" },
  deployed: { label: "В эксплуатации", tone: "ok" },
  inRepair: { label: "В ремонте", tone: "warn" },
  decommissioned: { label: "Списано", tone: "off" },
  inReserve: { label: "В резерве", tone: "info" },
  disposed: { label: "Утилизировано", tone: "bad" },
};

const TONE_TEXT = {
  ok: "tw:text-accent-text",
  warn: "tw:text-warning",
  info: "tw:text-info",
  bad: "tw:text-destructive",
  off: "tw:text-faint",
};
const TONE_DOT = {
  ok: "tw:bg-primary",
  warn: "tw:bg-warning",
  info: "tw:bg-info",
  bad: "tw:bg-destructive",
  off: "tw:bg-faint",
};

// Цветной статус-текст с точкой — общий для плитки и шторки устройства.
export const EnvStatusText = ({ tone = "off", className, children }) => (
  <span
    className={cn(
      "tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:font-medium tw:whitespace-nowrap",
      TONE_TEXT[tone],
      className,
    )}
  >
    <span
      aria-hidden
      className={cn("tw:size-1.5 tw:flex-none tw:rounded-full", TONE_DOT[tone])}
    />
    {children}
  </span>
);

// Mikrotik-статус связи. Только для управляемых устройств; при выключенном
// мониторинге статус устаревший — так и пишем, не утверждая онлайн/офлайн.
export const mikrotikStatus = (device) => {
  if (!device.mikrotikManaged) return null;
  if (!device.mikrotikMonitoringEnabled)
    return { label: "мониторинг выкл", tone: "off" };
  if (device.mikrotikStatus === "online") return { label: "В сети", tone: "ok" };
  return { label: "Не в сети", tone: "bad" };
};

// Иконка по названию типа устройства — типы свободные, поэтому матчим по
// ключевым словам с разумным запасным вариантом.
export const deviceIcon = (typeName = "") => {
  const t = (typeName || "").toLowerCase();
  if (/монитор|дисплей/.test(t)) return RiTvLine;
  if (/ноут|laptop/.test(t)) return RiMacbookLine;
  if (/систем|пк\b|компьютер|моноблок|настольн|desktop/.test(t))
    return RiComputerLine;
  if (/принт|мфу|сканер|печат/.test(t)) return RiPrinterLine;
  if (/сет|роутер|коммутат|маршрут|switch|router/.test(t)) return RiRouterLine;
  if (/телефон|смартфон|phone/.test(t)) return RiSmartphoneLine;
  if (/сервер|server|схд|nas/.test(t)) return RiServerLine;
  if (/гарнитур|наушник|headset/.test(t)) return RiHeadphoneLine;
  if (/ибп|ups|бесперебойн/.test(t)) return RiPlugLine;
  return RiHardDrive2Line;
};

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
  const status = STATUS_META[device.status];
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
              <EnvStatusText tone={status.tone}>{status.label}</EnvStatusText>
            )}
            {mikro && (
              <EnvStatusText tone={mikro.tone}>{mikro.label}</EnvStatusText>
            )}
          </span>
        )}
      </span>
    </button>
  );
};

export default EnvironmentDeviceTile;
