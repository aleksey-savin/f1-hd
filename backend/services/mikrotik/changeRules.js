// Правила приёма команд RouterOS от агента. Чистый модуль: без моделей, логов и ввода-вывода.
// Решает, что вообще можно показать человеку на утверждение.
const { isSecretField, isScriptField, SCRIPT_FIELDS, PUBLIC_FIELDS } = require("./configRedact");

const MAX_COMMANDS = 30;
const MAX_WHERE = 5;
const MAX_PARAMS = 40;
const MAX_VALUE = 500;
const MAX_NAME = 64;
const ACTIONS = ["add", "set", "remove", "enable", "disable"];

// Подстановки: значение создаёт HD, секрет не проходит через агента.
const PLACEHOLDERS = {
  publicKey: "{{wireguard.public-key}}",
  presharedKey: "{{wireguard.preshared-key}}",
};
const PLACEHOLDER_FIELDS = {
  [PLACEHOLDERS.publicKey]: "public-key",
  [PLACEHOLDERS.presharedKey]: "preshared-key",
};

// Запретные разделы; совпадение по словам-префиксам, см. underPath.
const DENIED_PATHS = [
  "/user", "/system", "/file", "/tool", "/import", "/export", "/certificate",
  "/ip service", "/ip ssh", "/ppp secret", "/ip hotspot user", "/user-manager",
  "/container", "/snmp community", "/radius", "/password", "/console", "/port",
  "/special-login", "/tr069-client", "/ip socks", "/ip proxy", "/ip cloud", "/disk",
  "/ip ipsec key",
  // Решение контролёра (итоговая проверка): раздача файлов, приложения-контейнеры, разделы диска, чужая сеть
  "/ip tftp", "/ip smb", "/app", "/partitions", "/zerotier",
];

// Полные имена полей-секретов: консоль принимает сокращения («private-k»), поэтому
// любой префикс такого имени тоже считается секретом.
const SECRET_NAMES = [
  "password", "passphrase", "passcode", "private-key", "preshared-key", "secret", "shared-secret",
  "key", "auth-key", "enc-key", "tls-key", "wpa-pre-shared-key", "wpa2-pre-shared-key",
  "wpa3-pre-shared-key", "supplicant-password", "authentication-password", "encryption-password",
  "authentication-key", "encryption-key", "community", "token", "api-key", "cak", "pin",
  "pin-number", "static-key", "group-key", "pre-shared-key", "http-proxy-password",
  "mschapv2-password", "eap-password", "ipsec-secret", "user-password",
  "private-pre-shared-key", "private-passphrase", "sim-pin", "tcp-md5-key", "xauth-password",
  "management-protection-key",
];
// Настоящие поля, которые сами являются префиксом секретного имени: пропускаются по точному имени.
const NOT_SECRET = new Set(["user", "auth", "authentication", "group", "encryption", "http-proxy", "tls"]);

// chain читается из любого сокращения имени (от 2 символов), в params и where.
const chainValues = (obj) =>
  Object.entries(obj || {})
    .filter(([name]) => name.length >= 2 && "chain".startsWith(name))
    .map(([, value]) => String(value).trim().toLowerCase());

// add — по chain; остальное высокое, пока where.chain не доказал, что это не input
// (позже сверка пересчитает по настоящей строке). «!…» может оказаться input.
const firewallInput = (c) => {
  const own = chainValues(c.params);
  if (c.action === "add") return own.includes("input");
  if (own.some((v) => v === "input" || v.startsWith("!"))) return true;
  const found = chainValues(c.where);
  return !(found.length > 0 && found.every((v) => /^[a-z0-9-]+$/.test(v) && v !== "input"));
};

// Что может оборвать связь с устройством: помечается, не запрещается.
const RISKY = [
  { prefix: "/ip address", reason: "changes IP addresses" },
  { prefix: "/ip route", reason: "changes routes" },
  { prefix: "/ip firewall filter", when: firewallInput, reason: "changes input firewall rules" },
  { prefix: "/ip firewall raw", when: firewallInput, reason: "changes input firewall rules" },
  { prefix: "/ipv6 address", reason: "changes IPv6 addresses" },
  { prefix: "/ipv6 route", reason: "changes IPv6 routes" },
  { prefix: "/ipv6 firewall filter", when: firewallInput, reason: "changes input firewall rules" },
  { prefix: "/ipv6 firewall raw", when: firewallInput, reason: "changes input firewall rules" },
  { prefix: "/ip firewall nat", reason: "changes NAT" },
  { prefix: "/interface", exact: true, when: (c) => ["set", "remove", "disable"].includes(c.action), reason: "changes or disables interfaces" },
  { prefix: "/interface bridge", reason: "changes bridges" },
  { prefix: "/interface vlan", reason: "changes VLANs" },
  { prefix: "/routing", reason: "changes routing" },
  { prefix: "/ip dhcp-client", reason: "changes DHCP client" },
  { prefix: "/interface list", reason: "changes interface lists" },
];

const NAME = /^[a-z0-9][a-z0-9.-]*$/;
const CONTROL = /[\x00-\x1f\x7f]/;
// Только простые объекты: Date, Map и экземпляры классов — не набор полей
const isPlainObject = (v) => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const MAX_PATH_WORDS = 6;
const PATH_WORD = /^[a-z0-9][a-z0-9-]*$/;

// Консоль принимает однозначные префиксы слов меню: путь совпадает с эталоном, если
// каждое слово эталона начинается со слова пути (короче эталона — не совпадает).
const underPath = (path, base, exact = false) => {
  const words = path.slice(1).split(" ");
  const baseWords = base.slice(1).split(" ");
  if (words.length < baseWords.length || (exact && words.length !== baseWords.length)) return false;
  return baseWords.every((word, i) => word.startsWith(words[i]));
};

// Имя поля: префикс (или равно) имени скрипта / секрета — консоль сократит до него.
const looksLikeScript = (name) => isScriptField(name) || [...SCRIPT_FIELDS].some((f) => f.startsWith(name));
const looksLikeSecret = (path, name) =>
  isSecretField(path, name) || (!PUBLIC_FIELDS.has(name) && !NOT_SECRET.has(name) && SECRET_NAMES.some((f) => f.startsWith(name)));

const normalizePath = (path) => `/${path.replace(/\//g, " ").trim().split(/\s+/).filter(Boolean).join(" ")}`;

// Одно поле (из where или params) → текст ошибки или null.
const checkField = (path, name, value, { allowPlaceholder }) => {
  // Длинное имя не повторяем в ответе
  if (name.length > MAX_NAME) return `field name is too long (at most ${MAX_NAME} characters)`;
  if (!NAME.test(name)) return `invalid field name "${name}"`;
  if (typeof value !== "string") return `invalid value for "${name}": must be a string`;
  if (CONTROL.test(value) || value.length > MAX_VALUE) {
    return `invalid value for "${name}": control characters are not allowed, max ${MAX_VALUE} characters`;
  }
  if (looksLikeScript(name)) return `script field "${name}" is not allowed`;
  if (value.includes("{{") || value.includes("}}")) {
    if (!allowPlaceholder || PLACEHOLDER_FIELDS[value] !== name) {
      return `placeholder in "${name}" is not allowed (only ${PLACEHOLDERS.publicKey} in public-key and ${PLACEHOLDERS.presharedKey} in preshared-key)`;
    }
    return null;
  }
  if (looksLikeSecret(path, name)) return `secret field "${name}" accepts only a placeholder, not a literal value`;
  return null;
};

const checkCommand = (raw) => {
  if (!isPlainObject(raw)) return { error: "must be an object" };
  const { action } = raw;
  if (!ACTIONS.includes(action)) return { error: `action must be one of ${ACTIONS.join(", ")}` };
  if (typeof raw.path !== "string") return { error: "path must be a string" };
  const path = normalizePath(raw.path);
  if (path === "/") return { error: "path is required" };
  const pathWords = path.slice(1).split(" ");
  if (pathWords.length > MAX_PATH_WORDS || pathWords.some((word) => !PATH_WORD.test(word))) return { error: `invalid path "${path}"` };
  if (DENIED_PATHS.some((denied) => underPath(path, denied))) return { error: `${path} is not allowed` };

  let where = null;
  if (action === "add") {
    if (raw.where !== undefined && raw.where !== null) return { error: "where is not allowed for add" };
  } else {
    if (!isPlainObject(raw.where) || Object.keys(raw.where).length < 1 || Object.keys(raw.where).length > MAX_WHERE) {
      return { error: `where is required for ${action}: an object of 1-${MAX_WHERE} string pairs` };
    }
    where = raw.where;
  }

  const params = raw.params === undefined || raw.params === null ? {} : raw.params;
  if (!isPlainObject(params)) return { error: "params must be an object" };
  const count = Object.keys(params).length;
  if (action === "add" || action === "set") {
    if (count < 1 || count > MAX_PARAMS) return { error: `params must have 1-${MAX_PARAMS} pairs for ${action}` };
  } else if (count > 0) {
    return { error: `params must be empty for ${action}` };
  }

  for (const [name, value] of Object.entries(where || {})) {
    const error = checkField(path, name, value, { allowPlaceholder: false });
    if (error) return { error: `where: ${error}` };
  }
  const used = [];
  for (const [name, value] of Object.entries(params)) {
    const error = checkField(path, name, value, { allowPlaceholder: true });
    if (error) return { error };
    if (PLACEHOLDER_FIELDS[value] === name) used.push(value);
  }

  const command = { path, action, where: where && { ...where }, params: { ...params }, risk: "normal", riskReason: null };
  const risky = RISKY.find((rule) => underPath(path, rule.prefix, rule.exact) && (!rule.when || rule.when(command)));
  if (risky) {
    command.risk = "high";
    command.riskReason = `${risky.reason}: may cut off the device`;
  }
  return { command, used };
};

const validateProposal = (input) => {
  const list = isPlainObject(input) ? input.commands : undefined;
  if (!Array.isArray(list)) return { ok: false, errors: ["commands must be an array"] };
  if (list.length < 1) return { ok: false, errors: ["at least one command is required"] };
  if (list.length > MAX_COMMANDS) return { ok: false, errors: [`at most ${MAX_COMMANDS} commands per request`] };

  const errors = [];
  const commands = [];
  const placeholders = [];
  list.forEach((raw, index) => {
    const { command, used, error } = checkCommand(raw);
    if (error) {
      errors.push(`command ${index + 1}: ${error}`);
      return;
    }
    commands.push(command);
    for (const placeholder of used) if (!placeholders.includes(placeholder)) placeholders.push(placeholder);
  });
  if (errors.length) return { ok: false, errors };
  const risk = commands.some((c) => c.risk === "high") ? "high" : "normal";
  return { ok: true, commands, risk, placeholders };
};

Object.freeze(DENIED_PATHS);
Object.freeze(RISKY);

module.exports = { validateProposal, PLACEHOLDERS, MAX_COMMANDS, ACTIONS, DENIED_PATHS, RISKY };
