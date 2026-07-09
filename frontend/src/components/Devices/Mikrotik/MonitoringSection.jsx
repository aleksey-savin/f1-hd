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

// Карточка-секция (общий паттерн детальных страниц); actions — кнопки в
// заголовке справа.
const SectionCard = ({ icon, title, actions, children }) => (
  <Card className="border-0 shadow-sm h-100">
    <Card.Body>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div className="cap-card-title">
          {icon}
          <span>{title}</span>
        </div>
        {actions}
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
          <SectionCard
            icon={<RiRouterLine />}
            title="Подключение"
            actions={
              canManage && (
                <div className="d-flex flex-wrap gap-2">
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={onEditParams}
                  >
                    <RiSettings3Line /> Параметры
                  </Button>
                  <Button variant="outline-danger" size="sm" onClick={onDetach}>
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
              )
            }
          >
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
    </>
  );
};

export default MonitoringSection;
