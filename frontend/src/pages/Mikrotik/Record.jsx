import { useContext, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";

import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Alert from "react-bootstrap/Alert";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Tabs from "react-bootstrap/Tabs";
import Tab from "react-bootstrap/Tab";

import {
  RiRouterLine,
  RiPulseLine,
  RiShieldCheckLine,
  RiArrowGoBackFill,
} from "react-icons/ri";

import Transitions from "../../animations/Transition";
import MonitoringSection from "../../components/Devices/Mikrotik/MonitoringSection";
import ArtifactsSection from "../../components/Devices/Mikrotik/ArtifactsSection";
import StandaloneModal from "../../components/Devices/Mikrotik/StandaloneModal";
import ConfirmActionModal from "../../UI/ConfirmActionModal";
import { STATUS_BADGE } from "../../components/Devices/Mikrotik/DeviceOverview";
import { AuthedUserContext } from "../../store/authed-user-context";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { getLocalStorageData } from "../../util/auth";

// Страница standalone-устройства Mikrotik (Cloud Hosted Router): у него нет
// карточки в инвентаре, поэтому мониторинг и конфигурации живут на собственной
// странице, собранной из тех же секций, что и вкладки инвентарного устройства.
const MikrotikRecordPage = () => {
  const row = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageMikrotikDevices;
  const canManageConfigs = permissions.canManageMikrotikConfigs;

  const detachStandalone = useMikrotikDeviceFilterStore(
    (state) => state.detachStandalone,
  );

  const [showEdit, setShowEdit] = useState(false);
  const [showDetach, setShowDetach] = useState(false);
  const [isDetaching, setIsDetaching] = useState(false);
  const [detachError, setDetachError] = useState(null);

  const status = STATUS_BADGE[row.status] || STATUS_BADGE.offline;

  const handleDetach = async () => {
    setIsDetaching(true);
    setDetachError(null);
    try {
      const response = await detachStandalone(row.recordId);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setDetachError(data.message || "Не удалось выполнить действие");
        return;
      }
      navigate("/devices/mikrotik");
    } finally {
      setIsDetaching(false);
    }
  };

  return (
    <Transitions>
      {/* ── Шапка ── */}
      <div className="account-hero mb-4">
        <div
          className="d-flex align-items-center justify-content-center rounded-3 border flex-shrink-0 text-body-secondary"
          style={{ width: 72, height: 72, fontSize: "2rem" }}
        >
          <RiRouterLine />
        </div>

        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h2 className="mb-1 text-break">{row.displayName}</h2>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <Badge bg="secondary" className="fw-normal">
              Cloud Hosted Router
            </Badge>
            {row.company?.name && (
              <span className="text-body-secondary small">
                {row.company.name}
              </span>
            )}
          </div>
          {row.host && (
            <div className="font-monospace small text-body-secondary">
              {row.host}
            </div>
          )}
        </div>

        <div className="ms-sm-auto d-flex align-items-start">
          <Badge bg={status.bg} className="fs-6 fw-normal">
            {status.label}
          </Badge>
        </div>
      </div>

      {/* ── Вкладки ── */}
      <div className="company-view-tabs">
        <Tabs defaultActiveKey="monitoring" className="mb-3 scrollable-tabs">
          <Tab
            eventKey="monitoring"
            title={
              <>
                <RiPulseLine /> Мониторинг
              </>
            }
          >
            <div className="pt-1">
              <MonitoringSection
                device={row}
                canManage={canManage}
                onEditParams={() => setShowEdit(true)}
                onDetach={() => {
                  setDetachError(null);
                  setShowDetach(true);
                }}
              />
            </div>
          </Tab>

          {canManageConfigs && (
            <Tab
              eventKey="configs"
              title={
                <>
                  <RiShieldCheckLine /> Конфигурации
                </>
              }
            >
              <div className="pt-1">
                <ArtifactsSection
                  recordId={row.recordId}
                  type="export"
                  initialSchedule={row.schedules?.export}
                  canManage={canManageConfigs}
                />
              </div>
            </Tab>
          )}
        </Tabs>
      </div>

      <Row className="py-3 mt-2 border-top justify-content-end gap-2">
        <Col sm="auto">
          <Button
            variant="secondary"
            className="w-100"
            onClick={() => navigate("/devices/mikrotik")}
          >
            <RiArrowGoBackFill /> К списку
          </Button>
        </Col>
      </Row>

      <StandaloneModal
        show={showEdit}
        recordId={row.recordId}
        onClose={() => setShowEdit(false)}
        onSaved={() => {
          setShowEdit(false);
          revalidator.revalidate();
        }}
      />

      <ConfirmActionModal
        show={showDetach}
        onHide={() => setShowDetach(false)}
        onConfirm={handleDetach}
        title="Удалить устройство"
        body={
          <>
            Cloud Hosted Router <strong>{row.displayName}</strong> будет удалён
            из управления безвозвратно: запись, учётные данные и сертификат
            будут стёрты.
            {detachError && (
              <Alert variant="danger" className="mt-3 mb-0">
                {detachError}
              </Alert>
            )}
          </>
        }
        confirmLabel="Удалить"
        confirmVariant="danger"
        isLoading={isDetaching}
      />
    </Transitions>
  );
};

export default MikrotikRecordPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/standalone/${params.recordId}`,
    { headers: { Authorization: "Bearer " + token } },
  );

  if (!response.ok) throw response;

  const data = await response.json();
  document.title = data.displayName || "Устройство Mikrotik";
  return data;
}
