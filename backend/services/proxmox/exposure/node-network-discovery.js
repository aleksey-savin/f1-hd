const net = require("node:net");
const {
  collectGuestNetwork,
  configuredInterfaces,
  usableIp,
} = require("./guest-network");
const { fail } = require("../policy");
const discoveryCache = new Map();
const CACHE_MS = 60000;
const ROUTER_MAX_AGE_MS = 15 * 60000;
const MAX_GUESTS = 256;

const normalizedCidr = (value) => {
  const [ip, prefix, ...rest] = String(value || "").split("/");
  if (
    rest.length ||
    !usableIp(ip) ||
    !/^\d+$/.test(prefix || "") ||
    Number(prefix) > 32
  )
    return null;
  const size = 2 ** (32 - Number(prefix));
  const start =
    Math.floor(
      ip.split(".").reduce((n, part) => n * 256 + Number(part), 0) / size,
    ) * size;
  return `${[24, 16, 8, 0].map((shift) => Math.floor(start / 2 ** shift) % 256).join(".")}/${Number(prefix)}`;
};
const hostCidr = (row) => {
  if (row.cidr) return normalizedCidr(row.cidr);
  if (!row.address || row.netmask == null) return null;
  let prefix = String(row.netmask);
  if (net.isIPv4(prefix)) {
    const bits = prefix
      .split(".")
      .map((part) => Number(part).toString(2).padStart(8, "0"))
      .join("");
    if (!/^1*0*$/.test(bits)) return null;
    prefix = String(bits.indexOf("0") < 0 ? 32 : bits.indexOf("0"));
  }
  return normalizedCidr(`${row.address}/${prefix}`);
};
const splitConfig = (value) =>
  Object.fromEntries(
    String(value || "")
      .split(",")
      .map((part) => part.split("=")),
  );
const vlanOf = (value) =>
  value == null || value === "" ? null : Number(value);
const validVlan = (value) =>
  value === null || (Number.isInteger(value) && value >= 1 && value <= 4094);
const truthyFlag = (value) =>
  value === true ||
  value === "true" ||
  value === "yes" ||
  value === "1" ||
  value === 1;
const fresh = (value, now, age) => {
  const time = new Date(value || 0).getTime();
  return time > 0 && time <= now && now - time <= age;
};

async function readGuestInterfaces(guest, connection, request, now) {
  if (
    guest.status === "running" &&
    guest.guestNetwork?.lastAttemptOk &&
    fresh(guest.guestNetwork.checkedAt, now, CACHE_MS)
  ) {
    return guest.guestNetwork;
  }
  const base = `/nodes/${encodeURIComponent(guest.nodeName)}/${guest.guestType}/${guest.vmid}`;
  const configPath = `${base}/config?current=1`;
  const config = await request(connection, configPath, {
    method: "GET",
    timeout: 5000,
  });
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("Missing guest configuration");
  if (guest.status === "running") {
    return collectGuestNetwork(guest, connection, {
      now: new Date(now),
      request: (conn, path, options) =>
        path === configPath
          ? Promise.resolve(config)
          : request(conn, path, options),
    });
  }
  const interfaces = configuredInterfaces(config);
  for (const nic of interfaces) {
    const settings = splitConfig(
      guest.guestType === "lxc"
        ? config[nic.key]
        : config[`ipconfig${nic.key.slice(3)}`],
    );
    const cidr = normalizedCidr(settings.ip);
    if (cidr)
      nic.addresses = [
        {
          address: settings.ip.split("/")[0],
          prefix: Number(settings.ip.split("/")[1]),
        },
      ];
  }
  return { interfaces };
}

async function discoverNetworks(node, connection, deps, now) {
  const clock = deps.clock || Date.now;
  const deadline = clock() + 15000;
  const call = deps.request || require("../transport").request;
  const request = (connection, path, options) => {
    const remaining = deadline - clock();
    if (remaining <= 0) throw new Error("Discovery deadline reached");
    return call(connection, path, {
      ...options,
      timeout: Math.min(options.timeout, remaining),
    });
  };
  const loadGuests =
    deps.loadGuests ||
    (async () =>
      require("../../../models/proxmox")
        .Resource.find({
          connectionId: node.connectionId,
          nodeName: node.nodeName,
          kind: "guest",
          archived: false,
          monitoringEnabled: { $ne: false },
          template: { $ne: true },
        })
        .select(
          "nodeName guestType vmid status monitoringEnabled guestIdentity createdAt +guestIncarnation +guestNetwork",
        )
        .limit(MAX_GUESTS + 1)
        .lean());
  const [host, guests] = await Promise.all([
    request(connection, `/nodes/${encodeURIComponent(node.nodeName)}/network`, {
      method: "GET",
      timeout: 5000,
    }),
    loadGuests(node),
  ]);
  if (!Array.isArray(host)) fail("Не удалось прочитать сети узла", 502);
  const bridges = new Map(
    host
      .filter((row) => /bridge/i.test(row.type || ""))
      .map((row) => [row.iface, row]),
  );
  const networks = new Map();
  const warnings = new Set();
  const add = (bridge, vlan, cidr) => {
    if (!bridges.has(bridge) || !validVlan(vlan) || !cidr) return;
    const key = JSON.stringify([bridge, vlan, cidr]);
    networks.set(key, {
      key,
      bridge,
      vlan,
      cidr,
      physical: String(bridges.get(bridge).bridge_ports || ""),
    });
  };
  for (const row of host) {
    if (bridges.has(row.iface)) add(row.iface, null, hostCidr(row));
    else if (row.type === "vlan") {
      const dotted = String(row.iface).match(/^(.*)\.(\d+)$/);
      add(
        row.vlan_raw_device || dotted?.[1],
        vlanOf(row.vlan_id ?? dotted?.[2]),
        hostCidr(row),
      );
    }
  }
  if (guests.length > MAX_GUESTS)
    warnings.add(
      "Проверены первые 256 гостей; список подсетей может быть неполным",
    );
  const pending = guests
    .slice(0, MAX_GUESTS)
    .filter(
      (guest) =>
        !guest.archived && !guest.template && guest.monitoringEnabled !== false,
    );
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      if (clock() >= deadline) {
        warnings.add(
          "Истекло время чтения сетей гостей; список подсетей может быть неполным",
        );
        break;
      }
      const guest = { ...pending[cursor++], nodeName: node.nodeName };
      try {
        const data = await readGuestInterfaces(guest, connection, request, now);
        if (data.lastError)
          warnings.add("Не у всех гостей доступны текущие IPv4-адреса");
        for (const nic of data.interfaces || []) {
          if (nic.trunks) {
            warnings.add(
              "Подсети trunk-интерфейсов требуют ручного сопоставления",
            );
            continue;
          }
          for (const address of nic.addresses || [])
            add(
              nic.bridge,
              vlanOf(nic.vlan),
              normalizedCidr(`${address.address}/${address.prefix}`),
            );
        }
      } catch {
        warnings.add(
          "Не удалось прочитать сеть части гостей; список подсетей может быть неполным",
        );
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, worker),
  );
  return {
    networks: [...networks.values()].sort(
      (a, b) =>
        a.bridge.localeCompare(b.bridge) ||
        (a.vlan || 0) - (b.vlan || 0) ||
        a.cidr.localeCompare(b.cidr),
    ),
    warnings: [...warnings],
  };
}

async function cachedNetworks(node, connection, deps, now) {
  const cache = deps.cache || discoveryCache;
  const clock = deps.clock || Date.now;
  const key = JSON.stringify([String(node.connectionId), node.nodeName]);
  const previous = cache.get(key);
  if (previous && (previous.pending || previous.until > clock()))
    return previous.value;
  for (const [name, entry] of cache)
    if (!entry.pending && entry.until <= clock()) cache.delete(name);
  if (cache.size >= 128) {
    const completed = [...cache].find(([, entry]) => !entry.pending);
    if (completed) cache.delete(completed[0]);
    else fail("Обнаружение сетей занято. Повторите попытку позже", 503);
  }
  const value = discoverNetworks(node, connection, deps, now);
  const entry = { pending: true, until: 0, value };
  cache.set(key, entry);
  try {
    const result = await value;
    entry.pending = false;
    entry.until = clock() + CACHE_MS;
    return result;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

function routerOptions(router, networks, now) {
  const result = {
    id: String(router._id),
    name: router.label || router.name || "MikroTik",
    address: router.credentials?.host || "",
    matches: [],
    wanOptions: [],
  };
  if (!fresh(router.lastSuccessfulConnectionAt, now, ROUTER_MAX_AGE_MS)) {
    result.error = "Нет свежих адресов MikroTik";
    return result;
  }
  const addresses = (router.addresses || []).filter(
    (row) =>
      !truthyFlag(row.disabled) && !truthyFlag(row.invalid) && row.interface,
  );
  if (!addresses.length) result.error = "Нет доступных IPv4-подсетей MikroTik";
  const seen = new Set();
  for (const address of addresses) {
    const cidr = normalizedCidr(address.address);
    if (!cidr) continue;
    for (const network of networks) {
      const key = JSON.stringify([network.key, address.interface]);
      if (network.cidr !== cidr || seen.has(key)) continue;
      seen.add(key);
      result.matches.push({
        networkKey: network.key,
        lanInterface: address.interface,
        cidr,
      });
    }
  }
  const segmentCounts = new Map();
  for (const match of result.matches) {
    const key = JSON.stringify([match.lanInterface, match.cidr]);
    segmentCounts.set(key, (segmentCounts.get(key) || 0) + 1);
  }
  for (const match of result.matches) {
    if (segmentCounts.get(JSON.stringify([match.lanInterface, match.cidr])) > 1)
      match.ambiguous = true;
  }
  return result;
}

async function getNodeNetworkOptions(node, deps = {}) {
  const now = new Date(deps.now || new Date()).getTime();
  const loadConnection =
    deps.loadConnection ||
    (async () =>
      require("../../../models/proxmox")
        .Connection.findById(node.connectionId)
        .select("+tokenSecret")
        .lean());
  const loadRouters =
    deps.loadRouters ||
    (async () =>
      require("../../../models/mikrotik")
        .find({ monitoringEnabled: true })
        .select(
          "name label credentials.host addresses lastSuccessfulConnectionAt",
        )
        .lean());
  const [connection, routers] = await Promise.all([
    loadConnection(node),
    loadRouters(),
  ]);
  if (!connection || connection.archived || !connection.monitoringEnabled)
    fail("Подключение недоступно", 404);
  const discovery = await cachedNetworks(node, connection, deps, now);
  return {
    ...discovery,
    routers: routers
      .filter((router) => router.monitoringEnabled !== false)
      .map((router) => routerOptions(router, discovery.networks, now)),
  };
}
module.exports = { getNodeNetworkOptions };
