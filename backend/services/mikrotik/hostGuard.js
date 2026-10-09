const net = require("net");
const dns = require("dns").promises;

const logger = require("../../utils/logger");

// --- SSRF guard: the device host is operator-supplied, so refuse to open
// connections to loopback / private / link-local (incl. cloud-metadata) targets.
//
// A router in the installation's own LAN (the gateway next to the HD server) is
// a legitimate direct target, so private addresses can be allowed — but only by
// whoever deploys HD, never from the UI: MIKROTIK_ALLOWED_PRIVATE_NETS lists
// IPv4 addresses or CIDR blocks (comma-separated, e.g. "10.0.50.1,10.0.60.0/24").
// Loopback, 0.0.0.0/8 and link-local/metadata stay blocked whatever it says.
const parseAllowedNets = (raw) => {
  const list = new net.BlockList();
  for (const item of String(raw || "").split(",")) {
    const entry = item.trim();
    if (!entry) continue;
    const [address, prefix] = entry.split("/");
    const bits = prefix === undefined ? 32 : Number(prefix);
    if (!net.isIPv4(address) || !Number.isInteger(bits) || bits < 8 || bits > 32) {
      logger.log("warn", "MIKROTIK_ALLOWED_PRIVATE_NETS: entry ignored", { entry });
      continue;
    }
    list.addSubnet(address, bits, "ipv4");
  }
  return list;
};

const isNeverAllowedIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 127 || a === 0 || (a === 169 && b === 254); // + cloud metadata
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fe80");
  }
  return false;
};

const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return a === 192 && b === 168;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low.startsWith("fc") || low.startsWith("fd");
  }
  return false;
};

const isBlockedIp = (ip, allowed) => {
  if (isNeverAllowedIp(ip)) return true;
  if (!isPrivateIp(ip)) return false;
  return !(net.isIPv4(ip) && allowed.check(ip, "ipv4"));
};

const assertPublicHost = async (
  host,
  allowedNets = process.env.MIKROTIK_ALLOWED_PRIVATE_NETS,
) => {
  let ips;
  if (net.isIP(host)) {
    ips = [host];
  } else {
    const resolved = await dns.lookup(host, { all: true });
    ips = resolved.map((entry) => entry.address);
  }
  const allowed = parseAllowedNets(allowedNets);
  if (ips.some((ip) => isBlockedIp(ip, allowed))) {
    const error = new Error(
      `Хост ${host} указывает на внутренний адрес и запрещён`,
    );
    error.code = "MIKROTIK_BLOCKED_HOST";
    throw error;
  }
};

// Мягкий SSRF-guard для целей за транзитом («подключение через устройство»):
// адрес за роутером — LAN, поэтому RFC1918/ULA легитимны; блокируются только
// loopback/link-local/0.0.0.0 и литерал localhost (незачем указывать роутеру
// на самого себя или в облачную метадату). Имена НЕ резолвятся: их резолвит
// роутер в своей сети, взгляд бэкенда на DNS нерелевантен.
const assertJumpTargetHost = (host) => {
  const blocked = (() => {
    if (net.isIPv4(host)) {
      const [a, b] = host.split(".").map(Number);
      return a === 127 || a === 0 || (a === 169 && b === 254);
    }
    if (net.isIPv6(host)) {
      const low = host.toLowerCase();
      return low === "::1" || low === "::" || low.startsWith("fe80");
    }
    return String(host).trim().toLowerCase() === "localhost";
  })();
  if (blocked) {
    const error = new Error(
      `Хост ${host} недопустим для подключения через транзитное устройство`,
    );
    error.code = "MIKROTIK_BLOCKED_HOST";
    throw error;
  }
};

module.exports = { assertPublicHost, assertJumpTargetHost };
