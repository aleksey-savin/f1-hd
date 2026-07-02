import { useContext, useState } from "react";

import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import Alert from "react-bootstrap/Alert";

import { RiSettings3Line, RiLinkUnlink } from "react-icons/ri";

import MikrotikAddressesModal from "./AddressesModal";
import ParametersModal from "./ParametersModal";
import ConfirmActionModal from "../../../UI/ConfirmActionModal";

import { formatDate } from "../../../util/format-date";
import { AuthedUserContext } from "../../../store/authed-user-context";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

const STATUS_BADGE = {
  online: { bg: "success", label: "В сети" },
  offline: { bg: "danger", label: "Не в сети" },
};

const MikrotikDevicesList = ({ items = [] }) => {
  const { permissions } = useContext(AuthedUserContext);
  const canManage = permissions.canManageMikrotikDevices;

  const detach = useMikrotikDeviceFilterStore((state) => state.detach);

  const [paramsDevice, setParamsDevice] = useState(null);
  const [detachDevice, setDetachDevice] = useState(null);
  const [isDetaching, setIsDetaching] = useState(false);
  const [detachError, setDetachError] = useState(null);

  const closeDetach = () => {
    setDetachDevice(null);
    setDetachError(null);
  };

  const handleDetach = async () => {
    if (!detachDevice) return;
    setIsDetaching(true);
    setDetachError(null);
    try {
      const response = await detach(detachDevice.clientDeviceId);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setDetachError(data.message || "Не удалось отключить устройство");
        return;
      }
      setDetachDevice(null);
    } finally {
      setIsDetaching(false);
    }
  };

  return (
    <>
      <Table responsive striped hover className="align-middle">
        <thead>
          <tr>
            <th>Имя</th>
            <th>Статус</th>
            <th>Расположение</th>
            <th>Модель</th>
            <th>Хост</th>
            <th>Адреса</th>
            <th>Прошивка</th>
            <th>Последнее подключение</th>
            {canManage && <th className="text-end">Действия</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((device) => {
            const badge = STATUS_BADGE[device.status] || STATUS_BADGE.offline;

            return (
              <tr key={device.clientDeviceId}>
                <td data-cell="Имя">
                  <span className="fw-semibold">{device.displayName}</span>
                </td>
                <td data-cell="Статус">
                  <Badge bg={badge.bg}>{badge.label}</Badge>
                </td>
                <td data-cell="Расположение">
                  {device.location?.name || "—"}
                </td>
                <td data-cell="Модель">{device.model?.name || "—"}</td>
                <td data-cell="Хост" className="font-monospace">
                  {device.host || "—"}
                </td>
                <td data-cell="Адреса">
                  <MikrotikAddressesModal device={device} />
                </td>
                <td data-cell="Прошивка" className="font-monospace">
                  {device.currentFirmware || (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td
                  data-cell="Последнее подключение"
                  className="text-nowrap text-muted"
                >
                  {device.lastSuccessfulConnectionAt
                    ? formatDate(device.lastSuccessfulConnectionAt)
                    : "—"}
                </td>
                {canManage && (
                  <td data-cell="Действия" className="text-end">
                    <ButtonGroup size="sm">
                      <Button
                        variant="outline-secondary"
                        onClick={() => setParamsDevice(device)}
                        title="Параметры подключения"
                        aria-label="Параметры подключения"
                      >
                        <RiSettings3Line />
                      </Button>
                      <Button
                        variant="outline-danger"
                        onClick={() => setDetachDevice(device)}
                        title="Отключить"
                        aria-label="Отключить"
                      >
                        <RiLinkUnlink />
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

      <ConfirmActionModal
        show={!!detachDevice}
        onHide={closeDetach}
        onConfirm={handleDetach}
        title="Отключить устройство"
        body={
          <>
            Устройство <strong>{detachDevice?.displayName}</strong> будет
            отвязано от управления Mikrotik: сохранённые параметры подключения
            (учётные данные и сертификат) будут удалены, а мониторинг остановлен.
            Само устройство останется в инвентаре — его можно добавить снова.
            {detachError && (
              <Alert variant="danger" className="mt-3 mb-0">
                {detachError}
              </Alert>
            )}
          </>
        }
        confirmLabel="Отключить"
        confirmVariant="danger"
        isLoading={isDetaching}
      />
    </>
  );
};

export default MikrotikDevicesList;
