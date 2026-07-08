import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";

import { FaNetworkWired } from "react-icons/fa";
import {
  RiRouterLine,
  RiPulseLine,
  RiSettings3Line,
  RiLinkUnlink,
  RiDeleteBinLine,
} from "react-icons/ri";

import DeviceOverview from "./DeviceOverview";
import AddressesTable from "./AddressesTable";
import AvailabilityReport from "./AvailabilityReport";
import ReconciliationAlert from "./ReconciliationAlert";

// Карточка-секция (общий паттерн детальных страниц).
const SectionCard = ({ icon, title, children }) => (
  <Card className="border-0 shadow-sm h-100">
    <Card.Body>
      <div className="cap-card-title mb-3">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </Card.Body>
  </Card>
);

// Блок «Мониторинг» настроенного устройства: подключение, адреса, отчёт о
// доступности и действия управления. Используется страницей инвентарного
// устройства и страницей standalone-записи (identity-строки скрыты — их
// показывает шапка страницы).
const MonitoringSection = ({
  device,
  canManage,
  onEditParams,
  onDetach,
  reconciliation,
  onSynced,
}) => {
  if (!device) return null;
  const isStandalone = device.source === "standalone";
  const networksCount = (device.addresses || []).filter(
    (item) => item.network,
  ).length;

  return (
    <>
      {!isStandalone && (
        <ReconciliationAlert
          // Ремоунт при смене набора расхождений — сбрасывает выбор полей.
          key={(reconciliation?.mismatches || [])
            .map((item) => item.field)
            .join(",")}
          clientDeviceId={device.clientDeviceId}
          reconciliation={reconciliation}
          canSync={canManage}
          onSynced={onSynced}
        />
      )}
      <Row className="g-3">
        <Col xs={12} lg={6}>
          <SectionCard icon={<RiRouterLine />} title="Подключение">
            <DeviceOverview device={device} showIdentity={false} />
          </SectionCard>
        </Col>
        <Col xs={12} lg={6}>
          <SectionCard
            icon={<FaNetworkWired />}
            title={`Адреса (${networksCount})`}
          >
            <AddressesTable addresses={device.addresses} />
          </SectionCard>
        </Col>
        <Col xs={12}>
          <SectionCard icon={<RiPulseLine />} title="Доступность">
            <AvailabilityReport recordId={device.recordId} />
          </SectionCard>
        </Col>
      </Row>

      {canManage && (
        <div className="d-flex flex-wrap justify-content-end gap-2 mt-3">
          <Button variant="outline-primary" onClick={onEditParams}>
            <RiSettings3Line /> Параметры подключения
          </Button>
          <Button variant="outline-danger" onClick={onDetach}>
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
  );
};

export default MonitoringSection;
