const { isSecretField, isScriptField, scrubUrls, FREE_TEXT_FIELDS, SECRET } = require("./configRedact");
const { redactSecrets } = require("../secretsScanner");

/**
 * Живая диагностика роутера для ИИ-агента (MCP): закрытый список команд
 * чтения, вычистка строк ответа, допуск цели ping и фильтр журнала. Чистый
 * модуль — на роутер ходит вызывающий (services/mcp/mikrotikSource.js).
 *
 * Команды состояния — только `…/print` без аргументов: от агента в них не
 * попадает ничего. Отбор (типы туннельных интерфейсов) делается над ответом,
 * а не запросом к роутеру.
 */

const TUNNEL_TYPES = new Set([
  "wg",
  "gre-tunnel",
  "ipip-tunnel",
  "eoip-tunnel",
  "l2tp-out",
  "l2tp-in",
  "sstp-out",
  "sstp-in",
  "ovpn-out",
  "ovpn-in",
  "pptp-out",
  "pptp-in",
  "pppoe-out",
  "pppoe-in",
  "ipsec",
  "vxlan",
  "zerotier",
]);

const STATE_COMMANDS = {
  interfaces: [{ title: "Interfaces", words: ["/interface/print"] }],
  tunnels: [
    {
      title: "Tunnel interfaces",
      words: ["/interface/print"],
      keep: (row) => TUNNEL_TYPES.has(String(row.type || "")),
    },
    { title: "WireGuard peers", words: ["/interface/wireguard/peers/print"] },
    { title: "PPP active sessions", words: ["/ppp/active/print"] },
    { title: "IPsec active peers", words: ["/ip/ipsec/active-peers/print"] },
  ],
  routes: [{ title: "Routes", words: ["/ip/route/print"] }],
  arp: [{ title: "ARP table", words: ["/ip/arp/print"] }],
  dhcp: [{ title: "DHCP leases", words: ["/ip/dhcp-server/lease/print"] }],
  resources: [{ title: "System resources", words: ["/system/resource/print"] }],
};
const STATE_CHECKS = Object.keys(STATE_COMMANDS);

// Что нужно знать о роутере, чтобы решить, можно ли пинговать адрес.
const NETWORK_COMMANDS = [
  { title: "addresses", words: ["/ip/address/print"] },
  { title: "routes", words: ["/ip/route/print"] },
  { title: "dns", words: ["/ip/dns/print"] },
  { title: "peers", words: ["/interface/wireguard/peers/print"] },
];

const LOG_WORDS = ["/log/print"];
const MAX_PING_COUNT = 5;
const DEFAULT_PING_COUNT = 3;

const clampCount = (count) =>
  Number.isInteger(count) ? Math.min(Math.max(count, 1), MAX_PING_COUNT) : DEFAULT_PING_COUNT;
// На роутер уходит адрес, собранный заново из проверенного числа, а не строка
// агента: «010.0.0.5» иначе могло бы быть прочитано роутером по-своему.
const pingWords = (address, count) => ["/ping", `=address=${canonicalIp(address)}`, `=count=${clampCount(count)}`];
const traceWords = (address) => ["/tool/traceroute", `=address=${canonicalIp(address)}`, "=count=1", "=max-hops=10"];

const SCRIPT_HIDDEN = "[скрипт скрыт]";
const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// «/interface/wireguard/peers/print» → «/interface wireguard peers»: тот же вид
// раздела, по которому configRedact знает секреты под обычным именем поля.
const sectionOf = (path) => `/${String(path).split("/").filter(Boolean).slice(0, -1).join(" ")}`;

/** Строка ответа API → строка для агента: без .id, секреты и скрипты скрыты. */
const redactRow = (path, row) => {
  const section = sectionOf(path);
  const out = {};
  for (const [name, value] of Object.entries(row || {})) {
    if (name === ".id") continue;
    const field = name.toLowerCase();
    if (isSecretField(section, field)) out[name] = SECRET;
    else if (isScriptField(field)) out[name] = SCRIPT_HIDDEN;
    else {
      const text = scrubUrls(String(value ?? "")).text;
      out[name] = oneLine(FREE_TEXT_FIELDS.has(field) ? redactSecrets(text).text || text : text);
    }
  }
  return out;
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const toInt = (address) => {
  const match = typeof address === "string" ? IPV4.exec(address) : null;
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
};
const canonicalIp = (address) => {
  const ip = toInt(address);
  if (ip === null) throw new Error("not an IPv4 address");
  return [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join(".");
};
const parseCidr = (value) => {
  const [ip, bitsRaw] = String(value || "").split("/");
  const base = toInt(ip);
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  return { base, bits };
};
const inNet = (ip, { base, bits }) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (base & mask) >>> 0;
};

/**
 * Можно ли пинговать адрес с этого роутера: адрес лежит в подключённой сети
 * или в маршруте (кроме маршрута по умолчанию) либо назван прямо — шлюз,
 * DNS-сервер, адрес пира туннеля (`extra`). Иначе роутер клиента стал бы
 * инструментом сканирования чужих сетей.
 */
const pingTarget = (address, { addresses = [], routes = [], extra = [] } = {}) => {
  const ip = toInt(address);
  if (ip === null) return { ok: false, reason: "address must be an IPv4 address like 10.0.0.5" };
  if (ip === 0 || ip >>> 24 === 127 || ip >>> 24 === 0 || ip >>> 28 >= 14) {
    return { ok: false, reason: "this address cannot be pinged" };
  }
  if (extra.includes(canonicalIp(address))) return { ok: true };
  // Выключенное не считается; неактивный маршрут считается — его и проверяют
  const live = (item) => item && String(item.disabled) !== "true" && String(item.invalid) !== "true";
  const nets = [...addresses.filter(live).map((item) => item.address), ...routes.filter(live).map((item) => item["dst-address"])]
    .map(parseCidr)
    .filter((net) => net && net.bits >= 8);
  return nets.some((net) => inNet(ip, net))
    ? { ok: true }
    : { ok: false, reason: "the address is outside the networks and routes of this device" };
};

// Адреса, названные в настройках роутера прямо: шлюзы, DNS, пиры туннелей.
const namedEndpoints = ({ routes = [], dns = [], peers = [] }) => {
  const found = [];
  const add = (value) => {
    for (const piece of String(value || "").split(",")) {
      const address = piece.trim().split(/[%:]/)[0];
      if (toInt(address) !== null) found.push(address);
    }
  };
  for (const route of routes) add(route.gateway);
  for (const row of dns) {
    add(row.servers);
    add(row["dynamic-servers"]);
  }
  for (const peer of peers) {
    add(peer["endpoint-address"]);
    add(peer["current-endpoint-address"]);
  }
  return [...new Set(found)];
};

const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 200;
const SCRIPT_OUTPUT = "[вывод скрипта скрыт]";
const hasTopic = (topics, name) => String(topics || "").split(",").includes(name);

/** Журнал для агента: без debug, без вывода скриптов, секреты в тексте скрыты. */
const filterLog = (rows, { topics, search, limit } = {}) => {
  const topic = String(topics || "").trim().toLowerCase();
  const needle = String(search || "").trim().toLowerCase();
  const max = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), MAX_LOG_LIMIT) : DEFAULT_LOG_LIMIT;
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !hasTopic(row.topics, "debug"))
    .map((row) => ({
      time: oneLine(row.time),
      topics: oneLine(row.topics),
      message: hasTopic(row.topics, "script")
        ? SCRIPT_OUTPUT
        : oneLine(redactSecrets(scrubUrls(String(row.message || "")).text).text),
    }))
    .filter((row) => !topic || hasTopic(row.topics.toLowerCase(), topic))
    .filter((row) => !needle || row.message.toLowerCase().includes(needle))
    .slice(-max);
};

const COMMAND_TIMEOUT_MS = 8000;

/**
 * Команды одной сессией, по очереди. Ошибка роутера (`!trap`: команды нет,
 * пакет не установлен) — законченный ответ: следующая команда идёт дальше.
 * Молчание — нет: запоздавший ответ достался бы следующей команде и вышел бы
 * под чужим заголовком, поэтому после него в эту сессию ничего не шлём.
 */
const runCommands = async (run, commands) => {
  const results = [];
  let silent = false;
  for (const { title, words, timeoutMs = COMMAND_TIMEOUT_MS } of commands) {
    if (silent) {
      results.push({ title, error: "not run: an earlier command did not answer" });
      continue;
    }
    try {
      results.push({ title, rows: await run(words, { timeoutMs }) });
    } catch (error) {
      silent = error?.message === "read timeout";
      results.push({ title, error: silent ? "the device did not answer in time" : String(error?.message || "failed") });
    }
  }
  return results;
};

module.exports = {
  runCommands,
  STATE_CHECKS,
  STATE_COMMANDS,
  NETWORK_COMMANDS,
  LOG_WORDS,
  pingWords,
  traceWords,
  redactRow,
  pingTarget,
  namedEndpoints,
  filterLog,
  toInt,
  canonicalIp,
};
