import { useContext, useState } from "react";

import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Spinner from "react-bootstrap/Spinner";
import Alert from "react-bootstrap/Alert";

import { RiSettings3Line, RiLink, RiLinkUnlink } from "react-icons/ri";

import MikrotikAddressesModal from "./AddressesModal";
import ParametersModal from "./ParametersModal";

import { formatShortDate } from "../../../util/format-date";
import { AuthedUserContext } from "../../../store/authed-user-context";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

const STATUS_BADGE = {
  online: { bg: "success", label: "В сети" },
  offline: { bg: "danger", label: "Не в сети" },
  notConfigured: { bg: "secondary", label: "Не настроено" },
};

const MikrotikDevicesList = ({ items = [] }) => {
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageMikrotikDevices;

  const connect = useMikrotikDeviceFilterStore((state) => state.connect);
  const disconnect = useMikrotikDeviceFilterStore((state) => state.disconnect);

  const [paramsDevice, setParamsDevice] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const handleMonitoringToggle = async (device) => {
    setBusyId(device.clientDeviceId);
    setActionError(null);
    try {
      const action = device.monitoringEnabled ? disconnect : connect;
      const response = await action(device.clientDeviceId);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setActionError(data.message || "Не удалось выполнить действие");
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {actionError && (
        <Alert variant="danger" dismissible onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Table responsive striped hover className="align-middle">
        <thead>
          <tr>
            <th>Имя</th>
            <th>Статус</th>
            <th>Локация</th>
            <th>Модель</th>
            <th>Хост</th>
            <th>Прошивка</th>
            <th>Последнее подключение</th>
            {canManage && <th className="text-end">Действия</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((device) => {
            const badge = STATUS_BADGE[device.status] || STATUS_BADGE.offline;
            const isBusy = busyId === device.clientDeviceId;
            const configured = device.status !== "notConfigured";
            const hasNetworks = device.addresses?.some((a) => a.network);

            return (
              <tr key={device.clientDeviceId}>
                <td data-cell="Имя">
                  <span className="fw-semibold">{device.displayName}</span>
                  {hasNetworks && (
                    <div className="mt-1">
                      <MikrotikAddressesModal device={device} />
                    </div>
                  )}
                </td>
                <td data-cell="Статус">
                  <Badge bg={badge.bg}>{badge.label}</Badge>
                  {device.monitoringEnabled && (
                    <Badge bg="light" text="dark" className="ms-1">
                      мониторинг
                    </Badge>
                  )}
                </td>
                <td data-cell="Локация">{device.location?.name || "—"}</td>
                <td data-cell="Модель">
                  {device.model?.name || "—"}
                  {device.model?.vendor && (
                    <div className="small text-muted">{device.model.vendor}</div>
                  )}
                </td>
                <td data-cell="Хост" className="font-monospace">
                  {device.host || "—"}
                </td>
                <td data-cell="Прошивка">
                  {device.currentFirmware ? (
                    <Badge bg="info" text="dark">
                      {device.currentFirmware}
                    </Badge>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td
                  data-cell="Последнее подключение"
                  className="text-nowrap text-muted"
                >
                  {device.lastSuccessfulConnectionAt
                    ? formatShortDate(device.lastSuccessfulConnectionAt)
                    : "—"}
                </td>
                {canManage && (
                  <td data-cell="Действия" className="text-end">
                    <ButtonGroup size="sm">
                      <Button
                        variant="outline-secondary"
                        onClick={() => setParamsDevice(device)}
                        title="Параметры подключения"
                      >
                        <RiSettings3Line /> Параметры
                      </Button>
                      <Button
                        variant={
                          device.monitoringEnabled
                            ? "outline-danger"
                            : "outline-success"
                        }
                        disabled={!configured || isBusy}
                        onClick={() => handleMonitoringToggle(device)}
                        title={
                          configured ? "" : "Сначала задайте параметры подключения"
                        }
                      >
                        {isBusy ? (
                          <Spinner animation="border" size="sm" />
                        ) : device.monitoringEnabled ? (
                          <>
                            <RiLinkUnlink /> Отключить
                          </>
                        ) : (
                          <>
                            <RiLink /> Подключить
                          </>
                        )}
                      </Button>
                    </ButtonGroup>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>

      <ParametersModal
        device={paramsDevice}
        show={!!paramsDevice}
        onClose={() => setParamsDevice(null)}
      />
    </>
  );
};

export default MikrotikDevicesList;
