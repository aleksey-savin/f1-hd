import { useState, useEffect } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";

import { FaNetworkWired } from "react-icons/fa";
import { RiSaveLine } from "react-icons/ri";

import MikrotikConnectionFields, {
  EMPTY,
  parseKnock,
} from "./MikrotikConnectionFields";

import { getLocalStorageData } from "../../../util/auth";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

// Connection parameters for an inventory-backed managed device (keyed by
// clientDeviceId). Standalone devices use StandaloneModal instead.
const ParametersModal = ({ device, show, onClose, onSaved }) => {
  const saveParameters = useMikrotikDeviceFilterStore(
    (state) => state.saveParameters,
  );

  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Prefill host/port/user/useTls from the stored record. The password and the
  // knock sequence are secrets the API never returns, so they stay blank.
  useEffect(() => {
    if (!show || !device) return;

    setError(null);
    setShowPassword(false);
    setForm({ ...EMPTY, host: device.host || "" });

    const controller = new AbortController();
    (async () => {
      try {
        const { token } = getLocalStorageData();
        const res = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/${device.clientDeviceId}`,
          {
            headers: { Authorization: "Bearer " + token },
            signal: controller.signal,
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        const creds = data.record?.credentials;
        if (creds) {
          setForm((prev) => ({
            ...prev,
            host: creds.host ?? prev.host,
            port: creds.port != null ? String(creds.port) : prev.port,
            user: creds.user ?? "",
            useTls: creds.useTls !== false,
            sshPort: creds.sshPort != null ? String(creds.sshPort) : prev.sshPort,
          }));
        }
      } catch {
        // aborted or network error — keep defaults
      }
    })();

    return () => controller.abort();
  }, [show, device]);

  const changeHandler = (event) =>
    setForm({ ...form, [event.target.name]: event.target.value });

  const submitHandler = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const response = await saveParameters(device.clientDeviceId, {
        host: form.host,
        port: Number(form.port),
        user: form.user,
        password: form.password,
        useTls: form.useTls,
        knockSequence: parseKnock(form.knockSequence),
        sshPort: Number(form.sshPort),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.message || "Не удалось сохранить параметры");
        return;
      }
      // onSaved (add-flow) закрывает весь мастер; иначе просто закрываем модалку.
      (onSaved || onClose)();
    } finally {
      setIsSaving(false);
    }
  };

  if (!device) return null;

  return (
    <Modal show={show} onHide={onClose} centered scrollable size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="h5 mb-0 d-flex align-items-center gap-2">
          <FaNetworkWired className="text-primary" />
          Параметры — {device.displayName}
        </Modal.Title>
      </Modal.Header>

      <Form onSubmit={submitHandler}>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}

          <MikrotikConnectionFields
            form={form}
            onChange={changeHandler}
            showPassword={showPassword}
            onToggleShowPassword={() => setShowPassword((prev) => !prev)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Button variant="primary" type="submit" disabled={isSaving}>
            {isSaving ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <RiSaveLine />
            )}{" "}
            Проверить и сохранить
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default ParametersModal;
