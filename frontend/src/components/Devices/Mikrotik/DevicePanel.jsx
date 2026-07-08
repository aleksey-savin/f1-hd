import { Link } from "react-router";

import Offcanvas from "react-bootstrap/Offcanvas";
import Button from "react-bootstrap/Button";
import Badge from "react-bootstrap/Badge";

import {
  RiRouterLine,
  RiSettings3Line,
  RiLinkUnlink,
  RiDeleteBinLine,
  RiExternalLinkLine,
} from "react-icons/ri";

import DeviceOverview, { STATUS_BADGE } from "./DeviceOverview";
import AvailabilityStrip from "./AvailabilityStrip";

// Right-side PREVIEW of a managed Mikrotik device: key facts + a 30-day uptime
// strip. The full picture (availability report, addresses, config exports) lives
// on the device page — the primary button below leads there. Connection actions
// stay in the footer (they run through the parent's modals).
const DevicePanel = ({ device, onClose, canManage, onEditParams, onDetach }) => {
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
          <>
            <div className="flex-grow-1 overflow-auto px-3 pt-2">
              <Link
                to={pageUrl}
                className="btn btn-primary w-100 mb-3 d-inline-flex align-items-center justify-content-center gap-2"
              >
                <RiExternalLinkLine /> Открыть страницу устройства
              </Link>

              <DeviceOverview device={device} />

              {device.recordId && device.monitoringEnabled && (
                <AvailabilityStrip recordId={device.recordId} />
              )}
            </div>

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
          </>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
};

export default DevicePanel;
