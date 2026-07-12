import { useEffect, useState } from "react";

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
  RiArrowDownSLine,
  RiFileCopyLine,
  RiCheckLine,
  RiRefreshLine,
} from "react-icons/ri";

import Select from "../../../UI/Select";

// Connection-form defaults shared by the Mikrotik parameter forms.
export const EMPTY = {
  host: "",
  port: "8729",
  user: "",
  password: "",
  useTls: true,
  knockSequence: "",
  sshPort: "22",
  // «Подключение через устройство»: recordId транзитного роутера ("" = напрямую).
  jumpRecordId: "",
};

const findOption = (options, value) =>
  options.find((option) => option.value === value) || null;

// «Подключение через устройство»: свитч, за которым прячется селект «Мост» —
// транзитный роутер, через SSH которого туннелируются API и SSH цели.
// Контролируемый: модалка владеет и состоянием свитча (сброс/префилл при
// открытии), и значением формы. `idPrefix` разводит id между модалками —
// обе смонтированы одновременно.
export const JumpBridgeField = ({
  idPrefix,
  enabled,
  onToggle,
  value,
  onChange,
  options,
  placeholder,
}) => (
  <Form.Group className="mb-3">
    <Form.Check
      type="switch"
      id={`${idPrefix}-jump-enabled`}
      label="Подключение через устройство"
      checked={enabled}
      onChange={(event) => onToggle(event.target.checked)}
    />
    {enabled && (
      <div className="mt-2">
        <Form.Label
          htmlFor={`${idPrefix}-jumpRecordId`}
          className="small mb-1"
        >
          Мост
        </Form.Label>
        <Select
          inputId={`${idPrefix}-jumpRecordId`}
          options={options}
          value={findOption(options, value)}
          onChange={(option) =>
            onChange({
              target: {
                name: "jumpRecordId",
                value: option ? option.value : "",
              },
            })
          }
          placeholder={placeholder}
          isClearable
        />
        <Form.Text className="text-muted">
          SSH-туннель через уже подключённый роутер MikroTik — для устройств в
          LAN без проброса портов. На роутере выполните:{" "}
          <code>/ip ssh set forwarding-enabled=local</code>
        </Form.Text>
      </div>
    )}
  </Form.Group>
);

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

// Least-privilege group policy for the managed user (never full/policy/sensitive).
const MANAGED_POLICY = "api,read,test,ssh";

// Three distinct random high ports (20000–39999) for the knock sequence.
const genKnockPorts = () => {
  const ports = new Set();
  while (ports.size < 3) ports.add(20000 + Math.floor(Math.random() * 20000));
  return [...ports];
};

// A strong random password (crypto RNG) from an unambiguous, RouterOS-quote-safe
// alphabet (no " \ $ ` and no 0/O/1/l/I lookalikes).
const genPassword = () => {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%*-_=+";
  const bytes = new Uint32Array(20);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
};

// Builds the copy-pastable RouterOS setup script from the chosen presets, filling
// in the values from the form so device config and app config always match. Each
// command is a full-path one-liner so it can be copied and run line by line.
const buildSetupCommands = ({
  presets,
  host,
  user,
  password,
  apiPort,
  sshPort,
  knockPorts,
}) => {
  const commonName = host?.trim() || "<имя-устройства>";
  const login = user?.trim() || "<логин>";
  const pass = password?.trim() || "<пароль>";
  const api = String(apiPort || "8729").trim();
  const ssh = String(sshPort || "22").trim();
  const [p1, p2, p3] =
    knockPorts.length === 3 ? knockPorts : ["<П1>", "<П2>", "<П3>"];

  const blocks = [];

  if (presets.user) {
    blocks.push(
      `# Пользователь с минимальными правами (без full/policy/sensitive)
/user group add name=hd-mgmt policy=${MANAGED_POLICY}
/user add name=${login} group=hd-mgmt password="${pass}"`,
    );
  }

  if (presets.cert) {
    blocks.push(
      `# Самоподписанный сертификат (key-cert-sign+crl-sign → подпись без внешнего CA), API-SSL вкл, плейнтекст-API выкл
/certificate add name=hd-api common-name=${commonName} key-usage=digital-signature,key-encipherment,key-cert-sign,crl-sign,tls-server days-valid=3650 key-size=2048
/certificate sign hd-api
/ip service set api-ssl certificate=hd-api disabled=no
/ip service set api disabled=yes`,
    );
  }

  if (presets.knock) {
    const lines = [
      `# Port knocking — правила вставляются В НАЧАЛО цепочки input (place-before),
# чтобы стоять выше блокирующего правила. Стук ${p1} -> ${p2} -> ${p3} открывает
# ${api} (API-SSL) и ${ssh} (SSH) источнику на 8 часов. Якорь — через :global
# (:local не переживает построчную вставку в терминал).`,
      `:global hdTop [:pick [/ip firewall filter find chain=input] 0]`,
      `/ip firewall filter add chain=input action=add-src-to-address-list address-list=hd-knock1 address-list-timeout=15s protocol=tcp dst-port=${p1} comment="hd knock 1" place-before=$hdTop`,
      `/ip firewall filter add chain=input action=add-src-to-address-list address-list=hd-knock2 address-list-timeout=15s protocol=tcp dst-port=${p2} src-address-list=hd-knock1 comment="hd knock 2" place-before=$hdTop`,
      `/ip firewall filter add chain=input action=add-src-to-address-list address-list=hd-allowed address-list-timeout=8h protocol=tcp dst-port=${p3} src-address-list=hd-knock2 comment="hd knock 3" place-before=$hdTop`,
      `/ip firewall filter add chain=input action=accept protocol=tcp dst-port=${api},${ssh} src-address-list=hd-allowed comment="hd allow admin" place-before=$hdTop`,
    ];
    if (presets.drop) {
      lines.push(
        `# Закрыть admin-порты из WAN. connection-state=new не рвёт established-сессии;
# нужен interface-list WAN (в стоковом конфиге есть) — иначе укажите свой WAN.`,
        `/ip firewall filter add chain=input action=drop protocol=tcp dst-port=${api},${ssh} connection-state=new in-interface-list=WAN comment="hd drop admin (WAN)" place-before=$hdTop`,
      );
    }
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n") || "# Выберите хотя бы один пункт";
};

// Collapsible, copy-pastable device-setup instructions with presets (user /
// port-knock / cert / drop). The knock sequence is generated as random ports and
// written back into the form's knockSequence field, so the device config and the
// app's stored knock always match. Commands are copied line by line.
const SetupHelp = ({
  host,
  user,
  password,
  apiPort,
  sshPort,
  knockSequence,
  onChange,
  jumpSelected = false,
}) => {
  const [open, setOpen] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [presets, setPresets] = useState({
    user: true,
    cert: true,
    knock: true,
    drop: false,
  });

  const knockPorts = parseKnock(knockSequence || "").slice(0, 3);

  // Через транзит knock не используется — его пресеты выключаются и не
  // предлагаются в скрипте (доступ ограничивается файрволом устройства).
  const effectivePresets = jumpSelected
    ? { ...presets, knock: false, drop: false }
    : presets;

  // Generate random knock ports and push them into the form field.
  const generatePorts = () => {
    onChange?.({
      target: { name: "knockSequence", value: genKnockPorts().join(" ") },
    });
  };

  // Auto-fill knock ports when opening the block with knocking enabled and no
  // usable sequence yet — never clobbers a complete one the user already typed.
  useEffect(() => {
    if (
      open &&
      presets.knock &&
      !jumpSelected &&
      parseKnock(knockSequence || "").length < 3
    ) {
      generatePorts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presets.knock, jumpSelected]);

  const commands = buildSetupCommands({
    presets: effectivePresets,
    host,
    user,
    password,
    apiPort,
    sshPort,
    knockPorts,
  });

  const copyText = async (text, idx) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1500);
    } catch {
      // clipboard unavailable (non-secure context) — user can select manually
    }
  };

  const togglePreset = (key) =>
    setPresets((prev) => ({ ...prev, [key]: !prev[key] }));

  const isComment = (line) => line.trimStart().startsWith("#");

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
        Инструкция по настройке устройства
      </Button>

      <Collapse in={open}>
        <div>
          <div className="d-flex flex-wrap gap-3 mt-2 mb-3">
            <Form.Check
              type="checkbox"
              id="preset-user"
              label="Пользователь"
              checked={presets.user}
              onChange={() => togglePreset("user")}
            />
            <Form.Check
              type="checkbox"
              id="preset-cert"
              label="Сертификат + API-SSL"
              checked={presets.cert}
              onChange={() => togglePreset("cert")}
            />
            <Form.Check
              type="checkbox"
              id="preset-knock"
              label="Port knocking"
              checked={effectivePresets.knock}
              disabled={jumpSelected}
              onChange={() => togglePreset("knock")}
            />
            <Form.Check
              type="checkbox"
              id="preset-drop"
              label="Закрыть admin-порты из WAN"
              checked={effectivePresets.drop}
              disabled={!effectivePresets.knock || jumpSelected}
              onChange={() => togglePreset("drop")}
            />
          </div>

          <div className="d-flex justify-content-between align-items-center mb-1">
            <span className="small text-muted">RouterOS</span>
            <div className="d-flex gap-2">
              {effectivePresets.knock && (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="d-inline-flex align-items-center gap-1 py-0"
                  onClick={generatePorts}
                  title="Сгенерировать другие порты"
                >
                  <RiRefreshLine /> Порты
                </Button>
              )}
              <Button
                variant="outline-secondary"
                size="sm"
                className="d-inline-flex align-items-center gap-1 py-0"
                onClick={() => copyText(commands, "all")}
                title="Скопировать все команды"
              >
                {copiedIdx === "all" ? <RiCheckLine /> : <RiFileCopyLine />} Всё
              </Button>
            </div>
          </div>

          <div
            className="rounded p-2 mb-1"
            style={{
              maxHeight: "24rem",
              overflowY: "auto",
              background: "#1e1e1e",
              color: "#e6e6e6",
              border: "1px solid rgba(255, 255, 255, 0.12)",
            }}
          >
            {commands.split("\n").map((line, i) =>
              line.trim() === "" ? (
                <div key={i} style={{ height: ".45rem" }} />
              ) : (
                <div key={i} className="d-flex align-items-start gap-2">
                  <code
                    className="small"
                    style={{
                      flex: "1 1 auto",
                      minWidth: 0,
                      color: isComment(line) ? "#8a9a8a" : "#e6e6e6",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {line}
                  </code>
                  {!isComment(line) && (
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 flex-shrink-0"
                      style={{ color: "#9aa0a6", lineHeight: 1.3 }}
                      onClick={() => copyText(line, i)}
                      title="Скопировать строку"
                    >
                      {copiedIdx === i ? <RiCheckLine /> : <RiFileCopyLine />}
                    </Button>
                  )}
                </div>
              ),
            )}
          </div>

          <Form.Text className="text-muted">
            Логин, пароль и порты подставлены из формы — knock-порты уже в поле
            Port knocking выше. Правила knock ставятся в начало цепочки input.
            Сертификат самоподписанный (TOFU), <code>/certificate sign</code>{" "}
            занимает ~минуту.
          </Form.Text>
        </div>
      </Collapse>
    </div>
  );
};

// Shared host/port/user/password + port-knock fields for the Mikrotik connection
// forms (inventory ParametersModal and standalone StandaloneModal). The parent
// owns the form state and passes the handlers. Селект «Мост» живёт отдельно
// (JumpBridgeField — модалки размещают его после выбора компании); здесь по
// form.jumpRecordId лишь прячутся knock-поля и его пресеты в инструкции.
const MikrotikConnectionFields = ({
  form,
  onChange,
  showPassword,
  onToggleShowPassword,
  autoFocusHost = true,
}) => {
  const jumpSelected = Boolean(form.jumpRecordId);

  return (
  <>
    <SectionLabel>Подключение</SectionLabel>

    <Row className="g-3 mb-3">
      <Col sm={6}>
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
      <Col xs={6} sm={3}>
        <Form.Label htmlFor="port" className="small mb-1">
          Порт API-SSL <span className="text-danger">*</span>
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
      <Col xs={6} sm={3}>
        <Form.Label htmlFor="sshPort" className="small mb-1">
          SSH-порт
        </Form.Label>
        <Form.Control
          id="sshPort"
          name="sshPort"
          type="number"
          value={form.sshPort}
          onChange={onChange}
        />
      </Col>
    </Row>

    <Row className="g-3 mb-3">
      <Col sm={6}>
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
            placeholder="Выделенный, не Full"
            value={form.user}
            onChange={onChange}
          />
        </InputGroup>
      </Col>
      <Col sm={6}>
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
            onClick={() => {
              onChange({ target: { name: "password", value: genPassword() } });
              if (!showPassword) onToggleShowPassword();
            }}
            title="Сгенерировать пароль"
          >
            <RiRefreshLine />
          </Button>
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
      </Col>
    </Row>

    {jumpSelected ? (
      <div className="text-muted small mb-3">
        <RiKey2Line className="me-1" aria-hidden />
        Port knocking через туннель не используется — ограничьте доступ к
        API/SSH на устройстве файрволом по LAN-адресу роутера.
      </div>
    ) : (
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
          Порты через пробел или запятую. Заполняются автоматически из
          инструкции ниже.
        </Form.Text>
      </Form.Group>
    )}

    <SetupHelp
      host={form.host}
      user={form.user}
      password={form.password}
      apiPort={form.port}
      sshPort={form.sshPort}
      knockSequence={form.knockSequence}
      onChange={onChange}
      jumpSelected={jumpSelected}
    />
  </>
  );
};

export default MikrotikConnectionFields;
