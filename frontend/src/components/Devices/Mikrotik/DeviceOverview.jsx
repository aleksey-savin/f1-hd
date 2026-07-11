import Badge from "react-bootstrap/Badge";

import {
  RiBuildingLine,
  RiMapPin2Line,
  RiGlobalLine,
  RiCpuLine,
  RiInstallLine,
  RiBarcodeBoxLine,
  RiPulseLine,
  RiTimeLine,
  RiRefreshLine,
  RiErrorWarningLine,
} from "react-icons/ri";

import { formatDate } from "../../../util/format-date";
import FirmwareIndicator from "./FirmwareIndicator";

export const STATUS_BADGE = {
  online: { bg: "success", label: "В сети" },
  offline: { bg: "danger", label: "Не в сети" },
};

const emptyValue = <span className="text-body-secondary">—</span>;

// Icon-tile + label/value row (the .contact-row pattern used across the app).
export const InfoRow = ({ icon, label, mono, children }) => (
  <div className="contact-row">
    <span className="contact-row__icon">{icon}</span>
    <div style={{ minWidth: 0 }}>
      <div className="contact-row__label">{label}</div>
      <div
        className={`contact-row__value text-break ${mono ? "font-monospace" : ""}`}
      >
        {children || emptyValue}
      </div>
    </div>
  </div>
);

// Read-only facts of a managed Mikrotik device (a management-table row shape).
// Shared by the preview offcanvas and the device pages; the pages hide the
// identity rows (company/model/location) because their hero already shows them.
const DeviceOverview = ({ device, showIdentity = true }) => {
  if (!device) return null;
  const isStandalone = device.source === "standalone";

  return (
    <>
      {showIdentity && device.company?.name && (
        <InfoRow icon={<RiBuildingLine />} label="Компания">
          {device.company.name}
        </InfoRow>
      )}
      {showIdentity && !isStandalone && (
        <InfoRow icon={<RiCpuLine />} label="Модель">
          {device.model?.name}
        </InfoRow>
      )}
      {showIdentity && !isStandalone && (
        <InfoRow icon={<RiMapPin2Line />} label="Расположение">
          {device.location?.name}
        </InfoRow>
      )}
      <InfoRow icon={<RiGlobalLine />} label="Хост" mono>
        {device.host}
      </InfoRow>
      <InfoRow icon={<RiInstallLine />} label="Прошивка" mono>
        {device.currentFirmware && (
          <>
            {device.currentFirmware}
            <FirmwareIndicator
              status={device.firmwareStatus}
              displayName={device.displayName || device.name}
            />
          </>
        )}
      </InfoRow>
      <InfoRow icon={<RiCpuLine />} label="Плата">
        {device.boardName}
      </InfoRow>
      <InfoRow icon={<RiBarcodeBoxLine />} label="Серийный номер">
        {device.serialNumber}
      </InfoRow>
      <InfoRow icon={<RiPulseLine />} label="Мониторинг">
        {device.monitoringEnabled ? (
          <Badge bg="success">Включён</Badge>
        ) : (
          <span className="text-body-secondary">Выключен</span>
        )}
      </InfoRow>
      {/* Пока устройство в сети, «последнее подключение» и «последняя проверка»
          совпадают (успешный опрос = и то и другое) — показываем одну строку.
          Отдельное «последнее подключение» осмысленно только в офлайне: когда
          устройство в последний раз было живо. */}
      {device.status !== "online" && device.lastSuccessfulConnectionAt && (
        <InfoRow icon={<RiTimeLine />} label="Последнее подключение">
          {formatDate(device.lastSuccessfulConnectionAt)}
        </InfoRow>
      )}
      <InfoRow icon={<RiRefreshLine />} label="Последняя проверка">
        {device.lastCheckedAt && formatDate(device.lastCheckedAt)}
      </InfoRow>
      {device.lastError && (
        <InfoRow icon={<RiErrorWarningLine />} label="Ошибка">
          <span className="text-danger">{device.lastError}</span>
        </InfoRow>
      )}
    </>
  );
};

export default DeviceOverview;
