import { useState, useEffect } from "react";

import Offcanvas from "react-bootstrap/Offcanvas";
import Container from "react-bootstrap/Container";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Spinner from "react-bootstrap/Spinner";

import { FaNetworkWired } from "react-icons/fa";
import { RiSaveLine, RiRefreshLine, RiCheckLine } from "react-icons/ri";

import MikrotikConnectionFields, {
  EMPTY,
  parseKnock,
} from "./MikrotikConnectionFields";
import ReconciliationTable from "./ReconciliationTable";

import { getLocalStorageData } from "../../../util/auth";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

// Connection parameters for an inventory-backed managed device (keyed by
// clientDeviceId). Standalone devices use StandaloneModal instead.
//
// Two steps: "form" (verify-on-save) and, when the backend reports mismatches
// between the inventory card and the freshly polled device, "reconcile" — a diff
// table with per-field checkboxes and a one-click card update. Closing the
// offcanvas at the reconcile step simply skips the sync (params are saved).
const ParametersModal = ({ device, show, onClose, onSaved }) => {
  const saveParameters = useMikrotikDeviceFilterStore(
    (state) => state.saveParameters,
  );
  const syncInventory = useMikrotikDeviceFilterStore(
    (state) => state.syncInventory,
  );

  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [step, setStep] = useState("form");
  const [mismatches, setMismatches] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  // Prefill host/port/user/useTls from the stored record. The password and the
  // knock sequence are secrets the API never returns, so they stay blank.
  useEffect(() => {
    if (!show || !device) return;

    setError(null);
    setShowPassword(false);
    setStep("form");
    setMismatches([]);
    setSelected(new Set());
    setSyncError(null);
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
      // Параметры сохранены. Если карточка расходится со снятыми с устройства
      // данными — показываем шаг сверки; иначе закрываемся как раньше.
      const data = await response.json().catch(() => ({}));
      const found = data.reconciliation?.mismatches || [];
      if (found.length > 0) {
        setMismatches(found);
        setSelected(
          new Set(
            found.filter((item) => item.syncable).map((item) => item.field),
          ),
        );
        setStep("reconcile");
        return;
      }
      // onSaved (add-flow) закрывает весь мастер; иначе просто закрываем модалку.
      (onSaved || onClose)();
    } finally {
      setIsSaving(false);
    }
  };

  const toggleField = (field) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  // Шаг сверки завершён (синк или пропуск) — закрываем как обычное сохранение.
  const finishReconcile = () => (onSaved || onClose)();

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const response = await syncInventory(device.clientDeviceId, [
        ...selected,
      ]);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setSyncError(data.message || "Не удалось обновить карточку");
        return;
      }
      finishReconcile();
    } finally {
      setIsSyncing(false);
    }
  };

  if (!device) return null;

  const syncableCount = mismatches.filter((item) => item.syncable).length;

  // Закрытие крестиком/Esc на шаге сверки = «Пропустить»: параметры уже
  // сохранены, поэтому завершаем как успешное сохранение.
  const hideHandler = step === "reconcile" ? finishReconcile : onClose;

  return (
    <Offcanvas
      show={show}
      onHide={hideHandler}
      onEscapeKeyDown={hideHandler}
      keyboard
      placement="bottom"
      className="h-100"
    >
      <Offcanvas.Header closeButton>
        <Offcanvas.Title className="h5 mb-0 d-flex align-items-center gap-2">
          <FaNetworkWired className="text-primary" />
          {step === "reconcile"
            ? `Сверка данных — ${device.displayName}`
            : `Параметры — ${device.displayName}`}
        </Offcanvas.Title>
      </Offcanvas.Header>

      <Offcanvas.Body>
        <Container style={{ maxWidth: 820 }} className="pb-3">
          {step === "reconcile" ? (
            <>
              <Alert
                variant="success"
                className="d-flex align-items-center gap-2"
              >
                <RiCheckLine className="flex-shrink-0" />
                <span>
                  Параметры сохранены и проверены. Обнаружены расхождения
                  карточки устройства с данными, снятыми с него.
                </span>
              </Alert>

              <ReconciliationTable
                mismatches={mismatches}
                selected={selected}
                onToggle={toggleField}
              />

              {syncError && (
                <Alert variant="danger" className="mt-3 mb-0">
                  {syncError}
                </Alert>
              )}

              <div className="d-flex justify-content-end gap-2 pt-3 mt-3 border-top">
                <Button
                  variant="secondary"
                  onClick={finishReconcile}
                  disabled={isSyncing}
                >
                  Пропустить
                </Button>
                {syncableCount > 0 && (
                  <Button
                    variant="primary"
                    onClick={handleSync}
                    disabled={isSyncing || selected.size === 0}
                  >
                    {isSyncing ? (
                      <Spinner animation="border" size="sm" />
                    ) : (
                      <RiRefreshLine />
                    )}{" "}
                    Обновить карточку
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Form onSubmit={submitHandler}>
              {error && <Alert variant="danger">{error}</Alert>}

              <MikrotikConnectionFields
                form={form}
                onChange={changeHandler}
                showPassword={showPassword}
                onToggleShowPassword={() => setShowPassword((prev) => !prev)}
              />

              <div className="d-flex justify-content-end gap-2 pt-3 mt-3 border-top">
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
              </div>
            </Form>
          )}
        </Container>
      </Offcanvas.Body>
    </Offcanvas>
  );
};

export default ParametersModal;
