import { useContext, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { BrowserView, MobileView } from "react-device-detect";

import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import Alert from "react-bootstrap/Alert";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

import { RiArrowRightSLine } from "react-icons/ri";

import DevicePanel from "./DevicePanel";
import ParametersModal from "./ParametersModal";
import StandaloneModal from "./StandaloneModal";
import DeviceCard from "./DeviceCard";
import FirmwareIndicator from "./FirmwareIndicator";
import ConfirmActionModal from "../../../UI/ConfirmActionModal";
import AlertMessage from "../../../UI/AlertMessage";
import { uptimeToneClass } from "./AvailabilityReport";
import { STATUS_BADGE } from "./DeviceOverview";

import { formatDate } from "../../../util/format-date";
import { AuthedUserContext } from "../../../store/authed-user-context";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

// Рейтинг доступности за 30 дней: цветной процент (пороги как в отчёте).
const UptimeCell = ({ value }) => {
  if (value == null) {
    return (
      <OverlayTrigger
        placement="top"
        overlay={<Tooltip>Недостаточно данных</Tooltip>}
      >
        <span className="text-body-secondary">—</span>
      </OverlayTrigger>
    );
  }
  return (
    <OverlayTrigger
      placement="top"
      overlay={<Tooltip>Доступность за последние 30 дней</Tooltip>}
    >
      <span className={`fw-semibold ${uptimeToneClass(value)}`}>{value} %</span>
    </OverlayTrigger>
  );
};

const MikrotikDevicesList = ({ items = [] }) => {
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageMikrotikDevices;
  const canManageConfigs = permissions.canManageMikrotikConfigs;

  const detach = useMikrotikDeviceFilterStore((state) => state.detach);
  const detachStandalone = useMikrotikDeviceFilterStore(
    (state) => state.detachStandalone,
  );
  const searchTerm = useMikrotikDeviceFilterStore((state) => state.searchTerm);

  const [panelDevice, setPanelDevice] = useState(null);
  const [paramsDevice, setParamsDevice] = useState(null);
  const [standaloneEdit, setStandaloneEdit] = useState(null);
  const [detachDevice, setDetachDevice] = useState(null);
  const [isDetaching, setIsDetaching] = useState(false);
  const [detachError, setDetachError] = useState(null);

  const [searchParams] = useSearchParams();
  const deepLinkHandled = useRef(false);

  // Deep-link: open a device's panel when the page is opened with ?clientDeviceId=
  // (from a ticket's environment) or ?recordId= (from an offline-alert ticket).
  // Fires once the list has loaded; a ref guards against reopening after the user
  // closes it or the list refreshes.
  useEffect(() => {
    if (deepLinkHandled.current || !items.length) return;
    const cd = searchParams.get("clientDeviceId");
    const rec = searchParams.get("recordId");
    if (!cd && !rec) return;
    const match = items.find(
      (row) =>
        (cd && String(row.clientDeviceId) === cd) ||
        (rec && String(row.recordId) === rec),
    );
    if (match) setPanelDevice(match);
    deepLinkHandled.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const openParams = (device) => {
    if (device.source === "standalone") {
      setStandaloneEdit(device.recordId);
    } else {
      setParamsDevice(device);
    }
  };

  // Panel footer actions: open the connection modal / confirm detach, closing the
  // panel so the dialogs don't stack on top of the offcanvas.
  const handleEditParams = (device) => {
    setPanelDevice(null);
    openParams(device);
  };

  const handleDetachRequest = (device) => {
    setPanelDevice(null);
    setDetachDevice(device);
  };

  const closeDetach = () => {
    setDetachDevice(null);
    setDetachError(null);
  };

  const handleDetach = async () => {
    if (!detachDevice) return;
    setIsDetaching(true);
    setDetachError(null);
    try {
      const response =
        detachDevice.source === "standalone"
          ? await detachStandalone(detachDevice.recordId)
          : await detach(detachDevice.clientDeviceId);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setDetachError(data.message || "Не удалось выполнить действие");
        return;
      }
      setDetachDevice(null);
    } finally {
      setIsDetaching(false);
    }
  };

  const isStandaloneDetach = detachDevice?.source === "standalone";

  const firmwareCell = (device) =>
    device.currentFirmware ? (
      <>
        {device.currentFirmware}
        <FirmwareIndicator
          status={device.firmwareStatus}
          displayName={device.displayName}
        />
      </>
    ) : (
      <span className="text-muted">—</span>
    );

  return (
    <>
      {items.length === 0 ? (
        // ListWrapper показывает свой «Список пуст» только когда пуст и
        // originalList; здесь — случаи «все устройства не настроены» и «промах
        // поиска», и пустое состояние должно подсказывать действие.
        <AlertMessage
          variant="light"
          message={
            searchTerm
              ? "Ничего не нашлось. Измените поисковый запрос."
              : "Устройства ещё не добавлены. Нажмите «+», чтобы подключить первое устройство к мониторингу."
          }
        />
      ) : (
        <>
          <BrowserView>
            <Table responsive striped hover className="align-middle">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Тип</th>
                  <th>Расположение</th>
                  <th>Модель</th>
                  <th>Хост</th>
                  <th>Прошивка</th>
                  <th>
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip>За последние 30 дней</Tooltip>}
                    >
                      <span>Доступность</span>
                    </OverlayTrigger>
                  </th>
                  <th>Статус</th>
                  <th>Подключение</th>
                  <th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {items.map((device) => {
                  const badge =
                    STATUS_BADGE[device.status] || STATUS_BADGE.offline;

                  return (
                    <tr
                      key={device.recordId || device.clientDeviceId}
                      onClick={() => setPanelDevice(device)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setPanelDevice(device);
                      }}
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <div className="fw-semibold">{device.displayName}</div>
                        {device.company?.name && (
                          <div className="small text-muted">
                            {device.company.name}
                          </div>
                        )}
                      </td>
                      <td>{device.type || "—"}</td>
                      <td>{device.location?.name || "—"}</td>
                      <td>{device.model?.name || "—"}</td>
                      <td className="font-monospace">{device.host || "—"}</td>
                      <td className="font-monospace">{firmwareCell(device)}</td>
                      <td>
                        <UptimeCell value={device.uptime30d} />
                      </td>
                      <td>
                        <Badge bg={badge.bg}>{badge.label}</Badge>
                      </td>
                      <td className="text-nowrap text-muted">
                        {device.lastSuccessfulConnectionAt
                          ? formatDate(device.lastSuccessfulConnectionAt)
                          : "—"}
                      </td>
                      <td className="text-end text-muted">
                        <RiArrowRightSLine />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </BrowserView>
          <MobileView>
            {items.map((device) => (
              <DeviceCard
                key={device.recordId || device.clientDeviceId}
                device={device}
                onOpen={setPanelDevice}
              />
            ))}
          </MobileView>
        </>
      )}

      <DevicePanel
        device={panelDevice}
        onClose={() => setPanelDevice(null)}
        canManage={canManage}
        canManageConfigs={canManageConfigs}
        onEditParams={handleEditParams}
        onDetach={handleDetachRequest}
      />

      <ParametersModal
        device={paramsDevice}
        show={!!paramsDevice}
        onClose={() => setParamsDevice(null)}
      />

      <StandaloneModal
        show={!!standaloneEdit}
        recordId={standaloneEdit}
        onClose={() => setStandaloneEdit(null)}
      />

      <ConfirmActionModal
        show={!!detachDevice}
        onHide={closeDetach}
        onConfirm={handleDetach}
        title={isStandaloneDetach ? "Удалить устройство" : "Отключить устройство"}
        body={
          <>
            {isStandaloneDetach ? (
              <>
                Cloud Hosted Router <strong>{detachDevice?.displayName}</strong>{" "}
                будет удалён из управления безвозвратно: запись, учётные данные и
                сертификат будут стёрты.
              </>
            ) : (
              <>
                Устройство <strong>{detachDevice?.displayName}</strong> будет
                отвязано от управления Mikrotik: сохранённые параметры (учётные
                данные и сертификат) будут удалены, а мониторинг остановлен. Само
                устройство останется в инвентаре — его можно добавить снова.
              </>
            )}
            {detachError && (
              <Alert variant="danger" className="mt-3 mb-0">
                {detachError}
              </Alert>
            )}
          </>
        }
        confirmLabel={isStandaloneDetach ? "Удалить" : "Отключить"}
        confirmVariant="danger"
        isLoading={isDetaching}
      />
    </>
  );
};

export default MikrotikDevicesList;
