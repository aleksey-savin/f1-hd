// node --test services/mikrotik/changeMatch.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const match = require("./changeMatch");

const { sameConfig, diffField, volatileFor, parseDuration } = match;

const FW = ["filter", "nat", "mangle", "raw"].flatMap((t) => [`/ip firewall ${t}`, `/ipv6 firewall ${t}`]);
const FW_STATS = ["bytes", "packets", "invalid"];
const FW_CONFIG = ["chain", "action", "src-address", "dst-port", "connection-bytes", "connection-rate", "comment", "disabled", "dynamic"];
const QUEUE_STATS = ["bytes", "packets", "rate", "packet-rate", "queued-bytes", "queued-packets", "dropped"];
const QUEUE_CONFIG = ["max-limit", "limit-at", "priority", "queue", "parent", "burst-limit", "comment", "disabled", "name", "dynamic", "invalid"];
const ROUTE_STATE = ["active", "inactive", "gateway-status", "immediate-gw", "hw-offloaded"];
const ROUTE_CONFIG = ["gateway", "distance", "dst-address", "routing-table", "scope", "target-scope", "pref-src", "comment", "disabled", "dynamic", "suppress-hw-offload", "contribution"];
const LINK = ["last-link-up-time", "last-link-down-time", "fp-rx-byte", "fp-tx-byte", "fp-rx-packet", "fp-tx-packet"];

// Раздел → бегущие поля (смена — не дрейф) и настоящие настройки (смена — дрейф)
const MENUS = [
  ["/queue simple", [...QUEUE_STATS, "total-bytes", "total-packets", "total-rate", "total-packet-rate", "total-queued-bytes", "total-queued-packets", "total-dropped"],
    [...QUEUE_CONFIG, "target", "total-max-limit", "total-limit-at", "total-queue", "total-priority"]],
  ["/queue tree", QUEUE_STATS, [...QUEUE_CONFIG, "packet-mark", "total-bytes", "total-rate"]],
  ["/ip dhcp-server lease",
    ["active-address", "active-mac-address", "active-client-id", "active-server", "host-name", "class-id", "agent-circuit-id", "agent-remote-id", "expires-after", "last-seen", "status", "src-mac-address"],
    ["address", "mac-address", "server", "comment", "lease-time", "block-access", "client-id", "rate-limit", "address-lists", "dhcp-option", "always-broadcast", "disabled", "dynamic", "blocked", "radius"]],
  ["/ip route", ROUTE_STATE, ROUTE_CONFIG],
  ["/ipv6 route", ROUTE_STATE, ROUTE_CONFIG],
  ["/interface",
    ["rx-byte", "tx-byte", "rx-packet", "tx-packet", "rx-drop", "tx-drop", "rx-error", "tx-error", "tx-queue-drop", "link-downs", "running", "actual-mtu", ...LINK],
    ["name", "mtu", "l2mtu", "mac-address", "comment", "disabled", "type", "slave", "dynamic"]],
  ["/interface wireguard peers",
    ["rx", "tx", "last-handshake", "current-endpoint-address", "current-endpoint-port"],
    ["allowed-address", "endpoint-address", "endpoint-port", "persistent-keepalive", "public-key", "comment", "interface", "disabled", "name", "dynamic", "responder"]],
  ...FW.map((path) => [path, FW_STATS, FW_CONFIG]),
  ["/ip firewall address-list", ["creation-time"], ["list", "address", "comment", "disabled", "dynamic"]],
  ["/ipv6 firewall address-list", ["creation-time"], ["list", "address", "comment", "disabled", "dynamic"]],
  ["/ip arp", ["complete", "status"], ["address", "mac-address", "interface", "published", "comment", "disabled", "dynamic", "invalid", "DHCP"]],
  ["/interface bridge vlan", ["current-tagged", "current-untagged"], ["bridge", "vlan-ids", "tagged", "untagged", "comment", "disabled", "dynamic"]],
  ["/ip ipsec policy", ["active", "ph2-state", "ph2-count"],
    ["src-address", "dst-address", "peer", "proposal", "action", "level", "tunnel", "sa-src-address", "sa-dst-address", "protocol", "comment", "disabled", "dynamic", "invalid", "template", "group"]],
  ["/ip address", ["actual-interface", "invalid"], ["address", "network", "interface", "comment", "disabled", "dynamic"]],
  ["/ipv6 address", ["actual-interface", "invalid"], ["address", "interface", "advertise", "eui-64", "from-pool", "no-dad", "comment", "disabled", "dynamic", "link-local", "global"]],
  ["/ip dns static", [], ["name", "address", "ttl", "type", "regexp", "match-subdomain", "comment", "disabled", "dynamic"]],
  ["/ip dhcp-server network", [], ["address", "gateway", "dns-server", "netmask", "domain", "comment", "dynamic"]],
  ["/ip pool", ["used", "available"], ["name", "ranges", "next-pool", "comment", "total"]],
];

const changed = (path, name) => !sameConfig(path, { keep: "1", [name]: "after" }, { keep: "1", [name]: "before" });
const appeared = (path, name) => !sameConfig(path, { keep: "1", [name]: "after" }, { keep: "1" });
const vanished = (path, name) => !sameConfig(path, { keep: "1" }, { keep: "1", [name]: "before" });

for (const [path, runtime, config] of MENUS) {
  test(`${path}: бегущие поля — не дрейф, настройки — дрейф`, () => {
    for (const name of runtime) {
      assert.equal(changed(path, name), false, `${name} changed`);
      assert.equal(appeared(path, name), false, `${name} appeared`);
      assert.equal(vanished(path, name), false, `${name} vanished`);
    }
    for (const name of config) {
      assert.equal(changed(path, name), true, `${name} changed`);
      assert.equal(appeared(path, name), true, `${name} appeared`);
      assert.equal(vanished(path, name), true, `${name} vanished`);
      assert.equal(diffField(path, { [name]: "a" }, { [name]: "b" }), name);
    }
  });
}

test("карта разделов: в тесте перечислено ровно то, что в коде", () => {
  for (const [path, runtime] of MENUS) {
    const own = [...volatileFor(path)].filter((name) => !match.GLOBAL_VOLATILE.has(name)).sort();
    assert.deepEqual(own, runtime.filter((name) => !match.GLOBAL_VOLATILE.has(name)).sort(), path);
  }
  assert.deepEqual([...match.MENU_VOLATILE.keys()].sort(), MENUS.map(([path]) => path).sort());
});

test("общий набор: только длинные однозначные имена статистики интерфейса", () => {
  assert.deepEqual([...match.GLOBAL_VOLATILE].sort(), [...LINK].sort());
  const generic = ["rate", "status", "active", "inactive", "age", "rx", "tx", "bytes", "packets", "dropped", "running", "invalid", "uptime", "since",
    "host-name", "timeout", "dynamic", "disabled", "comment", "complete", "used", "rx-byte", "tx-byte", "actual-mtu", "creation-time", "last-seen", "expires-after"];
  for (const name of generic) assert.equal(match.GLOBAL_VOLATILE.has(name), false, name);
});

test("регрессия: rate в /interface ethernet switch … — настройка", () => {
  for (const path of ["/interface ethernet switch rule", "/interface ethernet switch ingress-port-policer", "/interface ethernet switch shaper"]) {
    assert.equal(sameConfig(path, { switch: "switch1", rate: "10M" }, { switch: "switch1", rate: "100M" }), false, path);
    assert.equal(diffField(path, { rate: "10M" }, { rate: "100M" }), "rate");
    assert.equal(volatileFor(path).has("rate"), false);
  }
});

test("регрессия: host-name в /ip dhcp-client — настройка", () => {
  assert.equal(sameConfig("/ip dhcp-client", { interface: "ether1", "host-name": "evil" }, { interface: "ether1", "host-name": "router" }), false);
  assert.equal(diffField("/ip dhcp-client", { "host-name": "a" }, { "host-name": "b" }), "host-name");
});

test("неизвестный раздел сверяется точно: любая статистика — дрейф (безопасный отказ)", () => {
  for (const path of ["/some new menu", "/routing bgp connection", "/interface ethernet", "/caps-man registration-table"]) {
    for (const name of ["bytes", "packets", "rate", "status", "active", "age", "rx", "tx", "dropped", "running", "invalid", "uptime", "since", "host-name", "rx-byte", "actual-mtu", "timeout"]) {
      assert.equal(changed(path, name), true, `${path} ${name}`);
    }
    assert.deepEqual([...volatileFor(path)].sort(), [...match.GLOBAL_VOLATILE].sort());
  }
  // однозначные имена статистики пропускаются везде
  for (const name of LINK) assert.equal(changed("/some new menu", name), false, name);
});

test("раздел ищется по точному пути: подразделы и соседи бегущих полей не наследуют", () => {
  const cases = [
    ["/ip route rule", "active"], ["/ip route vrf", "inactive"], ["/ip pool used", "used"], ["/ip ipsec policy group", "active"],
    ["/interface ethernet switch rule", "running"], ["/interface bridge port", "rx-byte"], ["/interface list member", "running"],
    ["/queue type", "rate"], ["/queue interface", "bytes"], ["/ip firewall layer7-protocol", "bytes"], ["/ip firewall service-port", "invalid"],
    ["/ip firewall address-list extra", "creation-time"], ["/ip firewall", "bytes"], ["/queue", "rate"], ["/ip", "status"],
    ["/ip firewall filterx", "bytes"], ["/ip firewall filte", "bytes"], ["/IP FIREWALL FILTER", "bytes"], ["", "bytes"],
  ];
  for (const [path, name] of cases) assert.equal(changed(path, name), true, `${path} ${name}`);
  // служебные имена объектов и мусор вместо пути карту не находят
  for (const path of ["constructor", "__proto__", "toString", "hasOwnProperty", null, undefined, 5, {}, ["/queue simple"]]) {
    assert.equal(changed(path, "bytes"), true, String(path));
  }
  // запись пути со слэшами и лишними пробелами — тот же раздел
  for (const path of ["/ip/firewall/filter", "ip firewall filter", " /ip  firewall  filter ", "/ip/firewall/filter/"]) {
    assert.equal(changed(path, "bytes"), false, path);
    assert.equal(changed(path, "chain"), true, path);
  }
});

test("volatileFor отдаёт свою копию: правка результата карту не портит", () => {
  volatileFor("/queue simple").add("max-limit");
  volatileFor("/some new menu").add("comment");
  assert.equal(changed("/queue simple", "max-limit"), true);
  assert.equal(changed("/some new menu", "comment"), true);
  assert.equal(changed("/queue tree", "comment"), true);
});

test("disabled и comment сверяются в каждом разделе", () => {
  for (const path of [...MENUS.map(([p]) => p), "/some new menu", "/ip dhcp-client", "/interface ethernet switch rule"]) {
    assert.equal(volatileFor(path).has("disabled"), false, path);
    assert.equal(sameConfig(path, { disabled: "true" }, { disabled: "false" }), false, path);
    assert.equal(sameConfig(path, { disabled: "false" }, { disabled: "no" }), true, path);
    assert.equal(changed(path, "comment"), true, path);
  }
});

test("свойства с точкой пропускаются везде", () => {
  for (const path of ["/ip firewall filter", "/some new menu"]) {
    assert.equal(sameConfig(path, { ".id": "*1", ".nextid": "*2", chain: "a" }, { ".id": "*9", chain: "a" }), true, path);
  }
});

test("равенство: true/false и yes/no, лишнее и пропавшее поле", () => {
  const P = "/ip firewall filter";
  assert.equal(sameConfig(P, { a: "1" }, { a: "1", b: "2" }), false);
  assert.equal(sameConfig(P, { a: "1", b: "2" }, { a: "1" }), false);
  assert.equal(sameConfig(P, { chain: "x", bytes: "1" }, { chain: "x", bytes: "9" }), true);
  assert.equal(diffField(P, { chain: "x", bytes: "1" }, { chain: "x", bytes: "9" }), null);
});

test("names (set): точное сравнение ровно этих полей, без пропусков и без правила timeout", () => {
  const AL = "/ip firewall address-list";
  assert.equal(diffField("/queue simple", { rate: "1", comment: "x" }, { rate: "2", comment: "y" }, ["rate"]), "rate");
  assert.equal(diffField("/queue simple", { rate: "1", comment: "x" }, { rate: "1", comment: "y" }, ["rate"]), null);
  assert.equal(diffField(AL, { timeout: "59m" }, { timeout: "1h" }, ["timeout"]), "timeout");
  assert.equal(diffField(AL, { timeout: "1h", list: "a" }, { timeout: "1h", list: "b" }, ["timeout"]), null);
  assert.equal(diffField(AL, { list: "a" }, { list: "b" }, []), null);
  assert.equal(diffField("/ip firewall filter", { bytes: "1" }, { bytes: "2" }, ["bytes"]), "bytes");
});

test("timeout: правило убывания только у address-list", () => {
  for (const path of ["/ip firewall address-list", "/ipv6 firewall address-list"]) {
    const stored = { list: "x", address: "1.1.1.1", timeout: "1h" };
    assert.equal(sameConfig(path, { ...stored, timeout: "59m50s" }, stored), true);
    assert.equal(sameConfig(path, { ...stored }, stored), true);
    assert.equal(sameConfig(path, { ...stored, timeout: "30d" }, stored), false);
    assert.equal(sameConfig(path, { ...stored, timeout: "1h1s" }, stored), false);
    assert.equal(sameConfig(path, { list: "x", address: "1.1.1.1" }, stored), false);
    assert.equal(sameConfig(path, stored, { list: "x", address: "1.1.1.1" }), false);
    assert.equal(sameConfig(path, { ...stored, timeout: "soon" }, stored), false);
    assert.equal(sameConfig(path, { ...stored, timeout: "59m" }, { ...stored, timeout: "soon" }), false);
    assert.equal(sameConfig(path, { ...stored, timeout: "soon" }, { ...stored, timeout: "soon" }), false);
    assert.equal(sameConfig(path, { list: "x", address: "1.1.1.1" }, { list: "x", address: "1.1.1.1" }), true);
    // миллисекунды не теряются: 900 мс против 500 мс — рост
    assert.equal(sameConfig(path, { ...stored, timeout: "900ms" }, { ...stored, timeout: "500ms" }), false);
    assert.equal(sameConfig(path, { ...stored, timeout: "500ms" }, { ...stored, timeout: "900ms" }), true);
    assert.equal(sameConfig(path, { ...stored, timeout: "1s500ms" }, { ...stored, timeout: "1s" }), false);
    assert.equal(volatileFor(path).has("timeout"), false);
  }
});

test("timeout: в остальных разделах — точное сравнение", () => {
  const paths = ["/ip firewall filter", "/ip firewall nat", "/ip dhcp-server lease", "/ip arp", "/ip dns static", "/some new menu",
    "/ip firewall connection tracking", "/ip firewall address-list extra", "/interface bridge host", "/ip ipsec policy"];
  for (const path of paths) {
    assert.equal(sameConfig(path, { timeout: "59m50s" }, { timeout: "1h" }), false, path);
    assert.equal(sameConfig(path, { timeout: "1h" }, { timeout: "1h" }), true, path);
    assert.equal(sameConfig(path, { timeout: "60m" }, { timeout: "1h" }), false, path);
    assert.equal(sameConfig(path, {}, { timeout: "1h" }), false, path);
  }
});

test("parseDuration: формы RouterOS", () => {
  const table = [
    ["1w2d3h4m5s", 7 * 86400 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5],
    ["1h", 3600], ["59m50s", 3590], ["30d", 30 * 86400], ["5s", 5], ["2d", 172800], ["1w", 604800],
    ["1m", 60], ["1h30m", 5400], ["0s", 0], ["000000001s", 1],
    // миллисекунды — дробью (было: отбрасывались)
    ["500ms", 0.5], ["1s500ms", 1.5], ["900ms", 0.9], ["1m1ms", 60.001], ["1500ms", 1.5], ["0ms", 0],
    ["00:59:50", 3590], ["1d 02:03:04", 86400 + 2 * 3600 + 3 * 60 + 4], ["10d 00:00:01", 864001], ["1d02:03:04", 93784],
    ["", null], ["abc", null], ["1x", null], ["5s1h", null], ["1h 30m", null], ["-5s", null], ["+5s", null], [null, null], [undefined, null], ["12:34", null],
    ["1e3s", null], ["1.5s", null], [" 5s", null], ["5s ", null], ["5s\n", null], ["5", null], ["s", null], ["ms", null], ["1ms1s", null], ["1h1h", null],
    ["٥s", null], ["５s", null], ["1d 02:03:04", null], ["0x10s", null], ["1,5s", null], ["5S", null],
    [5, null], [{}, null], [["5s"], null],
    // границы: не больше 9 цифр в группе, результат — безопасное целое число миллисекунд
    ["999999999s", 999999999], ["1000000000s", null], ["9999999999s", null], ["999999999ms", 999999.999], ["1000000000ms", null],
    ["99999999d", 99999999 * 86400], ["999999999d", null], ["999999999w", null], ["999999999w999999999d", null],
    ["1234567890d 00:00:00", null], ["99999999d 00:00:00", 99999999 * 86400], ["999999999d 00:00:00", null],
    [`${"9".repeat(400)}s`, null], [`${"1".repeat(30)}w`, null], ["100:00:00", null],
  ];
  for (const [text, seconds] of table) assert.equal(parseDuration(text), seconds, String(text));
  for (const [text] of table) {
    const value = parseDuration(text);
    assert.ok(value === null || (Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1000))), String(text));
  }
});

test("minors: clock minutes and seconds above 59 are not a duration", () => {
  assert.equal(match.parseDuration("99:99:99"), null);
  assert.equal(match.parseDuration("1d 00:60:00"), null);
  assert.equal(match.parseDuration("23:59:59"), 86399);
  assert.equal(match.parseDuration("99:59:59"), 359999);
});
