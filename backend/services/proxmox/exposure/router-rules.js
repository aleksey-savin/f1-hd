const { parseIPv4Set, union } = require("./ip-set");
const yes = (value) => ["yes", "true", "1"].includes(String(value));
const CONDITIONS = [
  "src-address",
  "dst-address",
  "src-address-list",
  "dst-address-list",
  "src-port",
  "dst-port",
  "protocol",
  "in-interface",
  "out-interface",
  "in-interface-list",
  "out-interface-list",
  "connection-state",
  "connection-nat-state",
  "dst-address-type",
];
const IGNORE = [
  ".id",
  "chain",
  "action",
  "disabled",
  "dynamic",
  "invalid",
  "comment",
  "bytes",
  "packets",
  "to-addresses",
  "to-ports",
  "jump-target",
  "log",
  "log-prefix",
];
const normalizeRule = (row, index) => ({
  id: String(row[".id"] || index),
  chain: String(row.chain || ""),
  action: String(row.action || ""),
  enabled: !yes(row.disabled) && !yes(row.invalid),
  conditions: Object.fromEntries(
    CONDITIONS.filter((key) => row[key] != null && row[key] !== "").map(
      (key) => [key, String(row[key])],
    ),
  ),
  unsupported: Object.keys(row).filter(
    (key) =>
      !IGNORE.includes(key) &&
      !CONDITIONS.includes(key) &&
      row[key] != null &&
      row[key] !== "",
  ),
  toAddress:
    typeof row["to-addresses"] === "string" ? row["to-addresses"] : null,
  toPorts: row["to-ports"] || null,
  jumpTarget: row["jump-target"] || null,
});
const normalizeRouter = (raw) => {
  const interfaces = (raw.interfaces || []).map((row) => ({
    name: row.name,
    type: row.type,
    running: row.running,
    disabled: row.disabled,
    dynamic: row.dynamic,
  }));
  const definitions = raw.interfaceLists || [],
    members = raw.listMembers || [],
    lists = {};
  const resolve = (name, stack = []) => {
    if (name === "none") return [];
    if (name === "all") return interfaces.map((row) => row.name);
    if (stack.includes(name)) return null;
    const def = definitions.find((row) => row.name === name);
    if (!def) return null;
    let set = members
      .filter((row) => row.list === name && !yes(row.disabled))
      .map((row) => row.interface);
    for (const nested of String(def.include || "")
      .split(",")
      .filter(Boolean)) {
      const value = resolve(nested, [...stack, name]);
      if (!value) return null;
      set.push(...value);
    }
    for (const nested of String(def.exclude || "")
      .split(",")
      .filter(Boolean)) {
      const value = resolve(nested, [...stack, name]);
      if (!value) return null;
      set = set.filter((item) => !value.includes(item));
    }
    return [...new Set(set)];
  };
  for (const def of definitions) lists[def.name] = resolve(def.name);
  const addressLists = {};
  for (const row of raw.addressLists || []) {
    if (yes(row.disabled)) continue;
    const name = row.list;
    if (addressLists[name] === null) continue;
    try {
      if (yes(row.dynamic) || (row.timeout && row.timeout !== "0s"))
        throw new Error("dynamic");
      addressLists[name] = union(
        addressLists[name] || [],
        parseIPv4Set(row.address),
      );
    } catch {
      addressLists[name] = null;
    }
  }
  const pick = (rows, keys) =>
    (rows || []).map((row) =>
      Object.fromEntries(
        keys.filter((key) => row[key] != null).map((key) => [key, row[key]]),
      ),
    );
  return {
    incompleteRules: ["nat", "filter", "raw", "mangle"].some((key) =>
      (raw[key] || []).some((row) => !row.chain || !row.action),
    ),
    routingRules: pick(raw.routingRules, [
      "src-address",
      "dst-address",
      "interface",
      "routing-mark",
      "action",
      "table",
      "disabled",
      "min-prefix",
    ]),
    nat: (raw.nat || []).map(normalizeRule),
    filter: (raw.filter || []).map(normalizeRule),
    raw: (raw.raw || []).map(normalizeRule),
    mangle: (raw.mangle || []).map(normalizeRule),
    interfaces,
    lists,
    interfaceLists: definitions.map((row) => ({ name: row.name })),
    addressLists,
    addresses: pick(raw.addresses, [
      "address",
      "interface",
      "disabled",
      "invalid",
    ]),
    routes: pick(raw.routes, [
      "dst-address",
      "gateway",
      "immediate-gw",
      "active",
      "disabled",
      "routing-table",
      "routing-mark",
      "type",
      "distance",
      "blackhole",
      "unreachable",
      "prohibit",
    ]),
    arp: pick(raw.arp, [
      "address",
      "mac-address",
      "interface",
      "complete",
      "disabled",
    ]),
    dhcp: pick(raw.dhcp, [
      "address",
      "active-address",
      "mac-address",
      "active-mac-address",
      "status",
      "server",
    ]),
    dhcpServers: pick(raw.dhcpServers, ["name", "interface", "disabled"]),
    connectionTracking: pick(raw.connectionTracking, ["enabled"]),
    ipSettings: pick(raw.ipSettings, ["ip-forward"]),
    bridgeSettings: pick(raw.bridgeSettings, ["use-ip-firewall"]),
  };
};
module.exports = { normalizeRouter, normalizeRule, yes };
