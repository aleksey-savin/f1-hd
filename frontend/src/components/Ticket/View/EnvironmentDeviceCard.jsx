import Badge from "react-bootstrap/Badge";
import {
  RiStarFill,
  RiMapPin2Line,
  RiComputerLine,
  RiMacbookLine,
  RiTvLine,
  RiPrinterLine,
  RiRouterLine,
  RiServerLine,
  RiSmartphoneLine,
  RiHardDrive2Line,
} from "react-icons/ri";

// Статусы ClientDevice → подпись + читаемый bootstrap-вариант. В тёмной теме не
// используем info (низкий контраст, см. ux-ui-guide); warning — с тёмным текстом.
export const STATUS_META = {
  readyForDeployment: { label: "Готово к выдаче", bg: "secondary" },
  deployed: { label: "В эксплуатации", bg: "success" },
  inRepair: { label: "В ремонте", bg: "warning", text: "dark" },
  decommissioned: { label: "Списано", bg: "secondary" },
  inReserve: { label: "В резерве", bg: "primary" },
  disposed: { label: "Утилизировано", bg: "danger" },
};

// Иконка по названию типа устройства — типы свободные, поэтому матчим по ключевым
// словам с разумным запасным вариантом.
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
  return RiHardDrive2Line;
};

const EnvironmentDeviceCard = ({ device, showLocation = false, onSelect }) => {
  const Icon = deviceIcon(device.typeName);
  const status = STATUS_META[device.status];

  return (
    <button
      type="button"
      className={`env-device${device.isPersonal ? " is-personal" : ""}`}
      onClick={() => onSelect?.(device)}
      title="Открыть карточку устройства"
    >
      <span className="env-device__icon">
        <Icon />
      </span>
      <div className="env-device__body">
        <div className="env-device__name" title={device.name}>
          <span className="text-truncate">{device.name}</span>
          {device.isPersonal && (
            <RiStarFill
              className="env-device__star"
              title="Закреплено лично за заявителем"
            />
          )}
        </div>
        {device.vendorName && (
          <div className="env-device__vendor">{device.vendorName}</div>
        )}
        {showLocation && device.locationName && (
          <div className="env-device__loc">
            <RiMapPin2Line /> {device.locationName}
          </div>
        )}
        {(device.inventoryNumber || device.serialNumber) && (
          <div className="env-device__ids">
            {device.inventoryNumber && (
              <span className="env-id" title="Инвентарный номер">
                {device.inventoryNumber}
              </span>
            )}
            {device.serialNumber && (
              <span className="env-id" title="Серийный номер">
                SN {device.serialNumber}
              </span>
            )}
          </div>
        )}
        {status && (
          <Badge
            bg={status.bg}
            text={status.text}
            className="env-device__status"
          >
            {status.label}
          </Badge>
        )}
      </div>
    </button>
  );
};

export default EnvironmentDeviceCard;
