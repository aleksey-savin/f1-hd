import { useState, useEffect } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";

import { FaNetworkWired } from "react-icons/fa";
import { RiSaveLine } from "react-icons/ri";

import Select from "../../../UI/Select";
import MikrotikConnectionFields, {
  EMPTY,
  parseKnock,
  SectionLabel,
} from "./MikrotikConnectionFields";

import { getLocalStorageData } from "../../../util/auth";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

const EMPTY_STANDALONE = { ...EMPTY, companyId: "", label: "" };

const findOption = (options, value) =>
  options.find((option) => option.value === value) || null;

// Add / edit a standalone managed device — one that has no inventory
// ClientDevice (e.g. a Cloud Hosted Router). Captures a company + optional label
// on top of the shared connection fields. `recordId` present ⇒ edit, else create.
const StandaloneModal = ({ show, recordId, onClose, onSaved }) => {
  const createStandalone = useMikrotikDeviceFilterStore(
    (state) => state.createStandalone,
  );
  const saveStandaloneParameters = useMikrotikDeviceFilterStore(
    (state) => state.saveStandaloneParameters,
  );

  const [form, setForm] = useState(EMPTY_STANDALONE);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isEdit = !!recordId;

  // Companies for the select.
  useEffect(() => {
    if (!show) return;
    const controller = new AbortController();
    (async () => {
      try {
        const { token } = getLocalStorageData();
        const res = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/companies`,
          {
            headers: { Authorization: "Bearer " + token },
            signal: controller.signal,
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        setCompanies(Array.isArray(data) ? data : []);
      } catch {
        // keep empty
      }
    })();
    return () => controller.abort();
  }, [show]);

  // Reset on open; prefill company/label/host/port/user/useTls when editing.
  // Password + knock are secrets the API never returns, so they stay blank.
  useEffect(() => {
    if (!show) return;

    setError(null);
    setShowPassword(false);
    setForm(EMPTY_STANDALONE);

    if (!recordId) return;

    const controller = new AbortController();
    (async () => {
      try {
        const { token } = getLocalStorageData();
        const res = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/mikrotik-devices/standalone/${recordId}`,
          {
            headers: { Authorization: "Bearer " + token },
            signal: controller.signal,
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        const record = data.record;
        const creds = record?.credentials;
        setForm((prev) => ({
          ...prev,
          companyId: record?.companyId?._id || record?.companyId || "",
          label: record?.label || "",
          host: creds?.host ?? prev.host,
          port: creds?.port != null ? String(creds.port) : prev.port,
          user: creds?.user ?? "",
          useTls: creds?.useTls !== false,
          sshPort: creds?.sshPort != null ? String(creds.sshPort) : prev.sshPort,
        }));
      } catch {
        // aborted or network error — keep defaults
      }
    })();

    return () => controller.abort();
  }, [show, recordId]);

  const changeHandler = (event) =>
    setForm({ ...form, [event.target.name]: event.target.value });

  const companyOptions = companies.map((company) => ({
    value: company._id,
    label: company.alias || company.fullTitle,
  }));

  const submitHandler = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const body = {
        companyId: form.companyId,
        label: form.label,
        host: form.host,
        port: Number(form.port),
        user: form.user,
        password: form.password,
        useTls: form.useTls,
        knockSequence: parseKnock(form.knockSequence),
        sshPort: Number(form.sshPort),
      };
      const response = isEdit
        ? await saveStandaloneParameters(recordId, body)
        : await createStandalone(body);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.message || "Не удалось сохранить устройство");
        return;
      }
      (onSaved || onClose)();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal show={show} onHide={onClose} centered scrollable size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="h5 mb-0 d-flex align-items-center gap-2">
          <FaNetworkWired className="text-primary" />
          {isEdit
            ? "Параметры — Cloud Hosted Router"
            : "Добавить Cloud Hosted Router"}
        </Modal.Title>
      </Modal.Header>

      <Form onSubmit={submitHandler}>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}

          <SectionLabel>Устройство</SectionLabel>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="companyId" className="small mb-1">
              Компания <span className="text-danger">*</span>
            </Form.Label>
            <Select
              inputId="companyId"
              options={companyOptions}
              value={findOption(companyOptions, form.companyId)}
              onChange={(option) =>
                setForm((prev) => ({
                  ...prev,
                  companyId: option ? option.value : "",
                }))
              }
              placeholder="Выберите компанию"
              isClearable
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="label" className="small mb-1">
              Название
            </Form.Label>
            <Form.Control
              id="label"
              name="label"
              type="text"
              placeholder="напр. CHR — Владивосток"
              value={form.label}
              onChange={changeHandler}
            />
            <Form.Text className="text-muted">
              Необязательно. Если пусто — берётся имя из RouterOS.
            </Form.Text>
          </Form.Group>

          <MikrotikConnectionFields
            form={form}
            onChange={changeHandler}
            showPassword={showPassword}
            onToggleShowPassword={() => setShowPassword((prev) => !prev)}
            autoFocusHost={false}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isSaving || !form.companyId}
          >
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

export default StandaloneModal;
