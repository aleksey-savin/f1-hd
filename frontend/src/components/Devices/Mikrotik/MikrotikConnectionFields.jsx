import { useState } from "react";

import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import InputGroup from "react-bootstrap/InputGroup";
import Collapse from "react-bootstrap/Collapse";

import { FaNetworkWired } from "react-icons/fa";
import {
  RiUserLine,
  RiLockPasswordLine,
  RiEyeLine,
  RiEyeOffLine,
  RiKey2Line,
  RiShieldKeyholeLine,
  RiTerminalBoxLine,
  RiArrowDownSLine,
  RiFileCopyLine,
  RiCheckLine,
} from "react-icons/ri";

// Connection-form defaults shared by the Mikrotik parameter forms.
export const EMPTY = {
  host: "",
  port: "8729",
  user: "",
  password: "",
  useTls: true,
  knockSequence: "",
  sshPort: "22",
};

// "22000 22111, 22222" -> [22000, 22111, 22222]
export const parseKnock = (value) =>
  value
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);

// Small uppercase section heading.
export const SectionLabel = ({ children, className = "" }) => (
  <div
    className={`text-uppercase text-muted small fw-semibold mb-2 ${className}`}
  >
    {children}
  </div>
);

// Collapsible, copy-pastable RouterOS commands to generate a self-signed cert and
// enable API-SSL. API-SSL is mandatory, so the device-side setup lives right in
// the form. `common-name` is prefilled from the entered host for convenience.
const CertHelp = ({ host }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const commonName = host?.trim() || "<имя-устройства>";
  const commands = [
    `/certificate add name=hd-api common-name=${commonName} key-usage=tls-server days-valid=3650 key-size=2048`,
    "/certificate sign hd-api",
    "/ip service set api-ssl certificate=hd-api disabled=no",
    "/ip service set api disabled=yes",
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(commands);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (non-secure context) — user can select manually
    }
  };

  return (
    <div className="mb-3">
      <Button
        variant="link"
        size="sm"
        className="p-0 text-decoration-none d-inline-flex align-items-center gap-1"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <RiArrowDownSLine
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .15s",
          }}
        />
        Команды генерации сертификата на RouterOS
      </Button>

      <Collapse in={open}>
        <div>
          <div className="d-flex justify-content-between align-items-center mt-2 mb-1">
            <span className="small text-muted">RouterOS terminal</span>
            <Button
              variant="outline-secondary"
              size="sm"
              className="d-inline-flex align-items-center gap-1 py-0"
              onClick={copy}
            >
              {copied ? <RiCheckLine /> : <RiFileCopyLine />}
              {copied ? "Скопировано" : "Копировать"}
            </Button>
          </div>
          <pre
            className="rounded p-2 small mb-1"
            style={{
              whiteSpace: "pre",
              overflowX: "auto",
              background: "#1e1e1e",
              color: "#e6e6e6",
              border: "1px solid rgba(255, 255, 255, 0.12)",
            }}
          >
            <code style={{ color: "inherit" }}>{commands}</code>
          </pre>
          <Form.Text className="text-muted">
            Сертификат самоподписанный — бэкенд доверяет ему при первом
            подключении (TOFU). Команда <code>/certificate sign</code> может
            занять ~минуту.
          </Form.Text>
        </div>
      </Collapse>
    </div>
  );
};

// Shared host/port/user/password + TLS + port-knock fields for the Mikrotik
// connection forms (inventory ParametersModal and standalone StandaloneModal).
// The parent owns the form state and passes the handlers.
const MikrotikConnectionFields = ({
  form,
  onChange,
  showPassword,
  onToggleShowPassword,
  autoFocusHost = true,
}) => (
  <>
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
            autoFocus={autoFocusHost}
            id="host"
            name="host"
            type="text"
            className="font-monospace"
            placeholder="203.0.113.10"
            value={form.host}
            onChange={onChange}
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
          onChange={onChange}
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
          onChange={onChange}
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
          onChange={onChange}
        />
        <Button
          variant="outline-secondary"
          type="button"
          tabIndex={-1}
          onClick={onToggleShowPassword}
          title={showPassword ? "Скрыть пароль" : "Показать пароль"}
        >
          {showPassword ? <RiEyeOffLine /> : <RiEyeLine />}
        </Button>
      </InputGroup>
    </Form.Group>

    <SectionLabel className="pt-2 border-top">Безопасность</SectionLabel>

    <div className="d-flex align-items-start gap-2 mb-2 small text-body-secondary">
      <RiShieldKeyholeLine className="text-success flex-shrink-0 mt-1" />
      <span>
        Соединение только по <strong>API-SSL (TLS)</strong> — обязательно, порт
        по умолчанию <span className="font-monospace">8729</span>.
        Плейнтекст-API не используется. На устройстве должна быть включена
        служба api-ssl с сертификатом.
      </span>
    </div>

    <CertHelp host={form.host} />

    <Form.Group className="mb-3">
      <Form.Label htmlFor="knockSequence" className="small mb-1">
        Port knocking
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
          onChange={onChange}
        />
      </InputGroup>
      <Form.Text className="text-muted">
        Порты через пробел или запятую. Пусто — не менять.
      </Form.Text>
    </Form.Group>

    <Form.Group className="mb-3">
      <Form.Label htmlFor="sshPort" className="small mb-1">
        SSH-порт
      </Form.Label>
      <InputGroup>
        <InputGroup.Text>
          <RiTerminalBoxLine />
        </InputGroup.Text>
        <Form.Control
          id="sshPort"
          name="sshPort"
          type="number"
          value={form.sshPort}
          onChange={onChange}
        />
      </InputGroup>
      <Form.Text className="text-muted">
        Для резервных копий и экспорта конфигурации (по умолчанию 22).
      </Form.Text>
    </Form.Group>

    {/* <Alert variant="light" className="border small mb-0">
      <div className="fw-semibold mb-1">Требования к устройству</div>
      <ul className="mb-0 ps-3">
        <li>
          Служба api-ssl включена и ей назначен сертификат, доступ ограничен IP
          сервера
        </li>
        <li>Пользователь — выделенный, не из группы Full</li>
        <li>Порт открывается по port knocking (если настроен)</li>
      </ul>
    </Alert> */}
  </>
);

export default MikrotikConnectionFields;
