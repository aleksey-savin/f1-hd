import { Link } from "react-router";

import Offcanvas from "react-bootstrap/Offcanvas";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Nav from "react-bootstrap/Nav";
import Tab from "react-bootstrap/Tab";
import Table from "react-bootstrap/Table";

import { FaNetworkWired } from "react-icons/fa";
import {
  RiRouterLine,
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
  RiSettings3Line,
  RiLinkUnlink,
  RiDeleteBinLine,
  RiExternalLinkLine,
} from "react-icons/ri";

import ArtifactsSection from "./ArtifactsSection";

import { formatDate } from "../../../util/format-date";
import { Col, Row } from "react-bootstrap";

const STATUS_BADGE = {
  online: { bg: "success", label: "В сети" },
  offline: { bg: "danger", label: "Не в сети" },
};

const emptyValue = <span className="text-body-secondary">—</span>;

// Icon-tile + label/value row (the .contact-row pattern used across the app).
const InfoRow = ({ icon, label, mono, children }) => (
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

// Right-side detail + management panel for a managed Mikrotik device. Read-only
// info in Обзор; config exports (.rsc) in their own tab; connection actions in
// the footer (they run through the parent's modals).
const DevicePanel = ({
  device,
  onClose,
  canManage,
  canManageConfigs,
  onEditParams,
  onDetach,
}) => {
  const isStandalone = device?.source === "standalone";
  const status = device
    ? STATUS_BADGE[device.status] || STATUS_BADGE.offline
    : null;
  const networks = (device?.addresses || []).filter((item) => item.network);

  return (
    <Offcanvas
      show={!!device}
      onHide={onClose}
      placement="end"
      keyboard
      className="mikrotik-panel"
    >
      <Offcanvas.Header closeButton>
        <div
          className="d-flex align-items-center gap-2"
          style={{ minWidth: 0 }}
        >
          <span className="contact-row__icon flex-shrink-0">
            <RiRouterLine />
          </span>
          <div style={{ minWidth: 0 }}>
            <Offcanvas.Title className="h6 mb-0 text-truncate">
              {device?.displayName}
            </Offcanvas.Title>
            <div className="small text-muted text-truncate">
              {device?.company?.name ||
                (isStandalone ? "Cloud Hosted Router" : "")}
              {status && (
                <Badge bg={status.bg} className="ms-2">
                  {status.label}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Offcanvas.Header>

      <Offcanvas.Body className="d-flex flex-column p-0 overflow-hidden">
        {device && (
          <Tab.Container defaultActiveKey="overview">
            <Nav variant="tabs" className="px-3 pt-1 flex-nowrap">
              <Nav.Item>
                <Nav.Link eventKey="overview">Обзор</Nav.Link>
              </Nav.Item>
              {canManageConfigs && (
                <Nav.Item>
                  <Nav.Link eventKey="export">Конфигурации</Nav.Link>
                </Nav.Item>
              )}
            </Nav>

            <Tab.Content className="flex-grow-1 overflow-auto px-3">
              <Tab.Pane eventKey="overview" className="pt-2">
                {device.company?.name && (
                  <InfoRow icon={<RiBuildingLine />} label="Компания">
                    {device.company.name}
                  </InfoRow>
                )}
                {!isStandalone && (
                  <InfoRow icon={<RiCpuLine />} label="Модель">
                    {device.model?.name}
                  </InfoRow>
                )}
                {!isStandalone && (
                  <InfoRow icon={<RiMapPin2Line />} label="Расположение">
                    {device.location?.name}
                  </InfoRow>
                )}
                <InfoRow icon={<RiGlobalLine />} label="Хост" mono>
                  {device.host}
                </InfoRow>
                <InfoRow icon={<RiInstallLine />} label="Прошивка" mono>
                  {device.currentFirmware}
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
                <InfoRow icon={<RiTimeLine />} label="Последнее подключение">
                  {device.lastSuccessfulConnectionAt &&
                    formatDate(device.lastSuccessfulConnectionAt)}
                </InfoRow>
                <InfoRow icon={<RiRefreshLine />} label="Последняя проверка">
                  {device.lastCheckedAt && formatDate(device.lastCheckedAt)}
                </InfoRow>
                {device.lastError && (
                  <InfoRow icon={<RiErrorWarningLine />} label="Ошибка">
                    <span className="text-danger">{device.lastError}</span>
                  </InfoRow>
                )}
                {!isStandalone && device.clientDeviceId && (
                  <Link
                    to={`/inventory/client-devices/${device.clientDeviceId}`}
                    className="btn btn-outline-secondary btn-sm w-100 mt-3 d-inline-flex align-items-center justify-content-center gap-2"
                  >
                    <RiExternalLinkLine /> Открыть в инвентаре
                  </Link>
                )}

                <div className="cap-card-title mt-4 mb-2">
                  <FaNetworkWired />
                  <span>Адреса ({networks.length})</span>
                </div>
                {networks.length > 0 ? (
                  <Table
                    responsive
                    striped
                    size="sm"
                    className="align-middle mb-0"
                  >
                    <thead>
                      <tr>
                        <th>Address</th>
                        <th>Network</th>
                        <th>Интерфейс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {networks.map((item) => (
                        <tr key={item._id}>
                          <td className="font-monospace">{item.address}</td>
                          <td className="font-monospace">{item.network}</td>
                          <td>{item.interface}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <div className="text-body-secondary small">
                    Нет привязанных к сети адресов
                  </div>
                )}
              </Tab.Pane>

              {canManageConfigs && (
                <Tab.Pane eventKey="export">
                  {device.recordId && (
                    <ArtifactsSection
                      recordId={device.recordId}
                      type="export"
                      initialSchedule={device.schedules?.export}
                      canManage={canManageConfigs}
                    />
                  )}
                </Tab.Pane>
              )}
            </Tab.Content>

            {canManage && (
              <div className="border-top p-3 d-flex flex-wrap justify-content-center gap-2">
                <Button
                  variant="outline-primary"
                  onClick={() => onEditParams(device)}
                >
                  <RiSettings3Line /> Параметры подключения
                </Button>
                <Button
                  variant="outline-danger"
                  onClick={() => onDetach(device)}
                >
                  {isStandalone ? (
                    <>
                      <RiDeleteBinLine /> Удалить
                    </>
                  ) : (
                    <>
                      <RiLinkUnlink /> Отключить
                    </>
                  )}
                </Button>
              </div>
            )}
          </Tab.Container>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
};

export default DevicePanel;
