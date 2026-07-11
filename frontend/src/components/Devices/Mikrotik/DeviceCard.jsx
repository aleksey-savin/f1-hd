import Card from "react-bootstrap/Card";
import Badge from "react-bootstrap/Badge";

import { RiArrowRightSLine } from "react-icons/ri";

import { STATUS_BADGE } from "./DeviceOverview";
import FirmwareIndicator from "./FirmwareIndicator";
import { uptimeToneClass } from "./AvailabilityReport";
import { formatDate } from "../../../util/format-date";

// Мобильная карточка строки управления Mikrotik. Сознательно легче общего
// UI/ItemCard: без меню действий (все действия живут в панели устройства) —
// тап по карточке открывает ту же панель, что клик по строке на десктопе.
const DeviceCard = ({ device, onOpen }) => {
  const badge = STATUS_BADGE[device.status] || STATUS_BADGE.offline;
  const meta = [device.type, device.model?.name].filter(Boolean).join(" · ");

  return (
    <Card
      className="mb-2 shadow-sm"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(device)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(device);
      }}
    >
      <Card.Body className="py-2 px-3">
        <div className="d-flex align-items-center gap-2">
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="fw-semibold text-truncate">
              {device.displayName}
            </div>
            {device.company?.name && (
              <div className="small text-muted text-truncate">
                {device.company.name}
              </div>
            )}
          </div>
          <Badge bg={badge.bg}>{badge.label}</Badge>
          <RiArrowRightSLine className="text-muted flex-shrink-0" aria-hidden />
        </div>

        <div className="small mt-2">
          {meta && <div className="text-body-secondary">{meta}</div>}
          <div className="d-flex flex-wrap column-gap-3 row-gap-1 mt-1">
            {device.host && (
              <span className="font-monospace">{device.host}</span>
            )}
            {device.currentFirmware && (
              <span className="font-monospace">
                {device.currentFirmware}
                <FirmwareIndicator
                  status={device.firmwareStatus}
                  displayName={device.displayName}
                />
              </span>
            )}
            {device.uptime30d != null && (
              <span
                className={`fw-semibold ${uptimeToneClass(device.uptime30d)}`}
              >
                {device.uptime30d} %
              </span>
            )}
          </div>
          {device.lastSuccessfulConnectionAt && (
            <div className="text-muted mt-1">
              Подключение: {formatDate(device.lastSuccessfulConnectionAt)}
            </div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
};

export default DeviceCard;
