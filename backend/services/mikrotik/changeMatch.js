// Общие чистые помощники сверки строк роутера: приём предложения (changeProposals) и применение (changeWorker).
// Без моделей и ввода-вывода.
const { redactRow } = require("./liveState");

const BOOL = { true: "yes", false: "no" };
// true/false и yes/no — одно и то же значение
const norm = (v) => BOOL[String(v)] || String(v);

const stripDots = (row) => Object.fromEntries(Object.entries(row).filter(([name]) => !name.startsWith(".")));

// Строка подходит под where: каждое поле есть и равно
const matches = (row, where) => Object.entries(where).every(([name, value]) => row[name] !== undefined && norm(row[name]) === norm(value));

// Строка роутера в том виде, в каком она хранится в command.before: секреты закрыты, служебные поля сняты
const redactedBefore = (path, row) => stripDots(redactRow(`${String(path).replace(/ /g, "/")}/print`, row));

// Бегущие значения (счётчики, время, состояние) меняются сами и дрейфом конфигурации не считаются.
// Короткое имя в одном разделе — статистика, в другом — настройка (rate: очередь и правило свитча),
// поэтому список свой у каждого раздела. В него идёт только то, что в ЭТОМ разделе доступно лишь на чтение
// в RouterOS 6 и 7; сомнение — не вносить: лишнее сравнение даёт безопасный отказ, лишний пропуск — нет.
// Раздел ищется по точному пути: подразделы и соседи ничего не наследуют (/ip route rule, /queue type).
// dynamic, disabled, comment не пропускаются нигде.
const QUEUE = ["bytes", "packets", "rate", "packet-rate", "queued-bytes", "queued-packets", "dropped"];
const QUEUE_TOTAL = ["total-bytes", "total-packets", "total-rate", "total-packet-rate", "total-queued-bytes", "total-queued-packets", "total-dropped"];
const ROUTE = ["active", "inactive", "gateway-status", "immediate-gw", "hw-offloaded"];
const RULE = ["bytes", "packets", "invalid"];
const ADDRESS = ["actual-interface", "invalid"];
const ADDRESS_LIST = ["creation-time"];
const MENU_VOLATILE = new Map([
  ["/queue simple", [...QUEUE, ...QUEUE_TOTAL]],
  ["/queue tree", QUEUE],
  ["/ip dhcp-server lease", [
    "active-address", "active-mac-address", "active-client-id", "active-server", "host-name", "class-id",
    "agent-circuit-id", "agent-remote-id", "expires-after", "last-seen", "status", "src-mac-address",
  ]],
  ["/ip route", ROUTE],
  ["/ipv6 route", ROUTE],
  ["/interface", [
    "rx-byte", "tx-byte", "rx-packet", "tx-packet", "rx-drop", "tx-drop", "rx-error", "tx-error",
    "tx-queue-drop", "link-downs", "running", "actual-mtu",
  ]],
  ["/interface wireguard peers", ["rx", "tx", "last-handshake", "current-endpoint-address", "current-endpoint-port"]],
  ["/ip firewall filter", RULE], ["/ip firewall nat", RULE], ["/ip firewall mangle", RULE], ["/ip firewall raw", RULE],
  ["/ipv6 firewall filter", RULE], ["/ipv6 firewall nat", RULE], ["/ipv6 firewall mangle", RULE], ["/ipv6 firewall raw", RULE],
  // timeout у записей списка — не здесь: особое правило ниже
  ["/ip firewall address-list", ADDRESS_LIST],
  ["/ipv6 firewall address-list", ADDRESS_LIST],
  ["/ip arp", ["complete", "status"]],
  ["/interface bridge vlan", ["current-tagged", "current-untagged"]],
  ["/ip ipsec policy", ["active", "ph2-state", "ph2-count"]],
  ["/ip address", ADDRESS],
  ["/ipv6 address", ADDRESS],
  ["/ip dns static", []],
  ["/ip dhcp-server network", []],
  ["/ip pool", ["used", "available"]],
]);

// Пропускается в любом разделе, в том числе вне карты. Только длинные имена статистики интерфейса,
// которые настройкой быть не могут: время последнего подъёма/падения линка и счётчики fast path.
// Коротким общим именам (rate, status, active, bytes, running…) здесь не место.
const GLOBAL_VOLATILE = new Set(["last-link-up-time", "last-link-down-time", "fp-rx-byte", "fp-tx-byte", "fp-rx-packet", "fp-tx-packet"]);

// Разделы, где timeout убывает сам
const DECAYING_TIMEOUT = new Set(["/ip firewall address-list", "/ipv6 firewall address-list"]);

// Путь раздела в виде «/ip firewall filter»; не строка — раздела нет
const menuOf = (path) => (typeof path === "string" ? `/${path.replace(/\//g, " ").trim().split(/ +/).filter(Boolean).join(" ")}` : null);

// Бегущие поля раздела (каждый раз новая копия). Раздел вне карты — только общий набор, то есть почти точное сравнение
const volatileFor = (path) => new Set([...GLOBAL_VOLATILE, ...(MENU_VOLATILE.get(menuOf(path)) || [])]);

const MAX_DIGITS = 9;
const UNITS = new RegExp(`^${["w", "d", "h", "m(?!s)", "s", "ms"].map((unit) => `(?:([0-9]{1,${MAX_DIGITS}})${unit})?`).join("")}$`);
const CLOCK = new RegExp(`^(?:([0-9]{1,${MAX_DIGITS}})d *)?([0-9]{1,2}):([0-9]{2}):([0-9]{2})$`);
const MS = [604800000, 86400000, 3600000, 60000, 1000, 1];

// Длительность RouterOS в секундах: 1w2d3h4m5s500ms (любое подмножество по порядку, мс — дробью),
// HH:MM:SS и «Nd HH:MM:SS». В группе не больше 9 цифр, сумма в мс — безопасное целое. Иное — null.
function parseDuration(text) {
  if (typeof text !== "string" || !text) return null;
  const clock = CLOCK.exec(text);
  const m = clock ? [null, null, clock[1], clock[2], clock[3], clock[4], null] : UNITS.exec(text);
  if (!m) return null;
  // Часы на циферблате: минут и секунд больше 59 не бывает
  if (clock && (Number(clock[3]) > 59 || Number(clock[4]) > 59)) return null;
  const ms = MS.reduce((sum, weight, i) => sum + Number(m[i + 1] || 0) * weight, 0);
  return Number.isSafeInteger(ms) ? ms / 1000 : null;
}

// timeout у записи убывает сам: свежее значение не больше сохранённого — не изменение; рост, появление, исчезновение, непонятное — изменение
function timeoutChanged(fresh, stored) {
  if ((fresh === undefined) !== (stored === undefined)) return true;
  if (fresh === undefined) return false;
  const a = parseDuration(String(fresh));
  const b = parseDuration(String(stored));
  return a === null || b === null || a > b;
}

// Первое отличающееся поле двух строк раздела path (fresh — что на роутере сейчас, stored — что было при запросе) или null.
// Без names сверяется вся строка, кроме бегущих полей раздела, а timeout записи address-list — по правилу убывания;
// с names — точное сравнение ровно этих полей.
function diffField(path, fresh, stored, names = null) {
  const menu = menuOf(path);
  const skip = volatileFor(path);
  const keys = names || [...new Set([...Object.keys(fresh), ...Object.keys(stored)])].filter((k) => !k.startsWith(".") && !skip.has(k));
  for (const key of keys) {
    if (!names && key === "timeout" && DECAYING_TIMEOUT.has(menu)) {
      if (timeoutChanged(fresh[key], stored[key])) return key;
      continue;
    }
    if ((fresh[key] === undefined) !== (stored[key] === undefined)) return key;
    if (fresh[key] !== undefined && norm(fresh[key]) !== norm(stored[key])) return key;
  }
  return null;
}

const sameConfig = (path, fresh, stored) => diffField(path, fresh, stored) === null;

module.exports = { norm, stripDots, matches, redactedBefore, MENU_VOLATILE, GLOBAL_VOLATILE, volatileFor, diffField, sameConfig, parseDuration };
