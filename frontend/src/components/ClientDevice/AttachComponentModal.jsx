import { useState, useEffect } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Spinner from "react-bootstrap/Spinner";

import { RiLinksLine } from "react-icons/ri";

import Select from "../../UI/Select";
import AlertMessage from "../../UI/AlertMessage";
import { getLocalStorageData } from "../../util/auth";
import { fetchAttachableDevices, describeDevice } from "./attachable";

const refId = (value) => value?._id || value || "";

// Прикрепление существующего устройства-комплектующего к сборке со страницы
// просмотра. Кандидаты — свободные устройства той же компании с прикрепляемым
// типом (комплектующие/расходники/периферия). Бэкенд: POST
// /client-devices/:id/components — компонент «следует за хостом».
const AttachComponentModal = ({ show, onHide, device, onAttached }) => {
  const companyId = refId(device?.companyId);
  const hostTypeId =
    device?.deviceModelId?.deviceTypeId?._id || refId(device?.deviceTypeId);

  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [componentId, setComponentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Загрузка свободных устройств при открытии.
  useEffect(() => {
    if (!show) return;
    setComponentId("");
    setError("");
    setLoading(true);
    let cancelled = false;
    fetchAttachableDevices({
      companyId,
      excludeId: device?._id,
      hostTypeId,
    }).then((list) => {
      if (cancelled) return;
      setOptions(
        list.map((d) => ({
          value: d._id,
          label: describeDevice(d).optionLabel,
        })),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [show, companyId, hostTypeId, device?._id]);

  const selected = options.find((o) => o.value === componentId) || null;

  const submit = async () => {
    if (!componentId) return;
    setSaving(true);
    setError("");
    const { token } = getLocalStorageData();
    const base = import.meta.env.VITE_API_ADDRESS;
    try {
      const response = await fetch(
        `${base}/api/inventory/client-devices/${device._id}/components`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ componentId }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Не удалось прикрепить устройство");
      }
      onAttached?.();
      onHide();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Прикрепить комплектующее</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <AlertMessage variant="danger" message={error} />}
        <Form.Group>
          <Form.Label htmlFor="attachComponentId">Устройство</Form.Label>
          <Select
            inputId="attachComponentId"
            placeholder={
              loading
                ? "Загрузка…"
                : options.length
                  ? "Выберите устройство"
                  : "Нет свободных устройств"
            }
            options={options}
            value={selected}
            onChange={(o) => setComponentId(o ? o.value : "")}
            isClearable
            isSearchable
            isLoading={loading}
            isDisabled={saving || loading || !options.length}
            noOptionsMessage={() => "Нет свободных устройств"}
          />
          <Form.Text className="text-muted">
            Свободные устройства той же компании с типом «Комплектующие»,
            «Расходники» или «Периферия». Прикреплённое перенимает расположение и
            пользователя сборки.
          </Form.Text>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={saving}>
          Отмена
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={saving || !componentId}
        >
          {saving ? (
            <Spinner animation="border" size="sm" />
          ) : (
            <>
              <RiLinksLine /> Прикрепить
            </>
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AttachComponentModal;
