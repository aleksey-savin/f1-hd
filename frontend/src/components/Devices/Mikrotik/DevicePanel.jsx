import { Link } from "react-router";

import Offcanvas from "react-bootstrap/Offcanvas";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";
import Nav from "react-bootstrap/Nav";
import Tab from "react-bootstrap/Tab";

import {
  RiRouterLine,
  RiSettings3Line,
  RiLinkUnlink,
  RiDeleteBinLine,
  RiExternalLinkLine,
} from "react-icons/ri";

import DeviceOverview, { STATUS_BADGE } from "./DeviceOverview";
import AvailabilityStrip from "./AvailabilityStrip";
import ArtifactsSection from "./ArtifactsSection";

// Right-side PREVIEW of a managed Mikrotik device. Обзор: key facts + a 30-day
// uptime strip + a link to the full device page; Конфигурации: the stored `.rsc`
// exports (gated by the config permission) — так резервные копии доступны прямо
// из списка, без перехода на страницу. Connection actions stay in the footer
// (they run through the parent's modals).
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
  const pageUrl = device
    ? isStandalone
      ? `/devices/mikrotik/records/${device.recordId}`
      : `/inventory/client-devices/${device.clientDeviceId}?tab=monitoring`
    : "#";

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
              {device?.company?.name || device?.type || ""}
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
              {canManageConfigs && device.recordId && (
                <Nav.Item>
                  <Nav.Link eventKey="export">Конфигурации</Nav.Link>
                </Nav.Item>
              )}
              <Link
                to={pageUrl}
                className="btn btn-outline-primary btn-sm ms-auto align-self-center d-inline-flex align-items-center gap-1 text-nowrap"
              >
                <RiExternalLinkLine /> Страница устройства
              </Link>
            </Nav>

            <Tab.Content className="flex-grow-1 overflow-auto px-3">
              <Tab.Pane eventKey="overview" className="pt-2">
                <DeviceOverview device={device} />

                {device.recordId && device.monitoringEnabled && (
                  <AvailabilityStrip recordId={device.recordId} />
                )}
              </Tab.Pane>

              {canManageConfigs && device.recordId && (
                <Tab.Pane eventKey="export" className="pt-2">
                  <ArtifactsSection
                    recordId={device.recordId}
                    type="export"
                    initialSchedule={device.schedules?.export}
                    canManage={canManageConfigs}
                  />
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
