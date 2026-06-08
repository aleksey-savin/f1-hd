import { useState, useEffect } from "react";

import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Spinner from "react-bootstrap/Spinner";
import InputGroup from "react-bootstrap/InputGroup";

import { FaNetworkWired } from "react-icons/fa";
import {
  RiSaveLine,
  RiUserLine,
  RiLockPasswordLine,
  RiEyeLine,
  RiEyeOffLine,
  RiKey2Line,
  RiShieldKeyholeLine,
} from "react-icons/ri";

import { getLocalStorageData } from "../../../util/auth";
import useMikrotikDeviceFilterStore from "../../../store/lists/mikrotik-devices";

const EMPTY = {
  host: "",
  port: "8729",
  user: "",
  password: "",
  useTls: true,
  knockSequence: "",
};

// "22000 22111, 22222" -> [22000, 22111, 22222]
const parseKnock = (value) =>
  value
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);

// Small uppercase section heading.
const SectionLabel = ({ children, className = "" }) => (
  <div
    className={`text-uppercase text-muted small fw-semibold mb-2 ${className}`}
  >
    {children}
  </div>
);

const ParametersModal = ({ device, show, onClose }) => {
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

  const toggleTls = (event) => {
    const useTls = event.target.checked;
    setForm((prev) => ({
      ...prev,
      useTls,
      // Nudge the default API port to match the transport.
      port:
        useTls && prev.port === "8728"
          ? "8729"
          : !useTls && prev.port === "8729"
            ? "8728"
            : prev.port,
    }));
  };

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
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.message || "Не удалось сохранить параметры");
        return;
      }
      onClose();
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

          <SectionLabel>Подключение</SectionLabel>

          <Row className="g-3 mb-3">
            <Col sm={8}>
              <Form.Label htmlFor="host" className="small mb-1">
                Хост <span className="text-danger">*</span>
              </Form.Label>
              <InputGroup>
                <InputGroup.Text>
                  <FaNetworkWired />
                </InputGroup.Text>
                <Form.Control
                  required
                  autoFocus
                  id="host"
                  name="host"
                  type="text"
                  className="font-monospace"
                  placeholder="203.0.113.10"
                  value={form.host}
                  onChange={changeHandler}
                />
              </InputGroup>
            </Col>
            <Col sm={4}>
              <Form.Label htmlFor="port" className="small mb-1">
                Порт <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                required
                id="port"
                name="port"
                type="number"
                value={form.port}
                onChange={changeHandler}
              />
            </Col>
          </Row>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="user" className="small mb-1">
              Имя пользователя <span className="text-danger">*</span>
            </Form.Label>
            <InputGroup>
              <InputGroup.Text>
                <RiUserLine />
              </InputGroup.Text>
              <Form.Control
                required
                id="user"
                name="user"
                type="text"
                placeholder="Выделенный пользователь (не Full)"
                value={form.user}
                onChange={changeHandler}
              />
            </InputGroup>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="password" className="small mb-1">
              Пароль <span className="text-danger">*</span>
            </Form.Label>
            <InputGroup>
              <InputGroup.Text>
                <RiLockPasswordLine />
              </InputGroup.Text>
              <Form.Control
                required
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={changeHandler}
              />
              <Button
                variant="outline-secondary"
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPassword ? <RiEyeOffLine /> : <RiEyeLine />}
              </Button>
            </InputGroup>
          </Form.Group>

          <SectionLabel className="pt-2 border-top">Безопасность</SectionLabel>

          <Form.Group className="mb-3">
            <Form.Check
              type="switch"
              id="useTls"
              name="useTls"
              checked={form.useTls}
              onChange={toggleTls}
              label={
                <span className="d-inline-flex align-items-center gap-1">
                  <RiShieldKeyholeLine /> API-SSL (TLS) — рекомендуется
                </span>
              }
            />
            <Form.Text className="text-muted">
              Шифрует канал; порт по умолчанию 8729.
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="knockSequence" className="small mb-1">
              Последовательность port knocking
            </Form.Label>
            <InputGroup>
              <InputGroup.Text>
                <RiKey2Line />
              </InputGroup.Text>
              <Form.Control
                id="knockSequence"
                name="knockSequence"
                type="text"
                className="font-monospace"
                placeholder="напр. 22000 22111 22222"
                value={form.knockSequence}
                onChange={changeHandler}
              />
            </InputGroup>
            <Form.Text className="text-muted">
              Порты через пробел или запятую. Пусто — не менять.
            </Form.Text>
          </Form.Group>

          <Alert variant="light" className="border small mb-0">
            <div className="fw-semibold mb-1">Требования к устройству</div>
            <ul className="mb-0 ps-3">
              <li>Включена служба api-ssl, ограниченная IP сервера</li>
              <li>Пользователь — выделенный, не из группы Full</li>
              <li>Порт открывается по port knocking (если настроен)</li>
            </ul>
          </Alert>
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
