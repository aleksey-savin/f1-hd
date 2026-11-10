const net = require("node:net");
const { createHash } = require("node:crypto");
const mongoose = require("mongoose");
const { fail } = require("../policy");
const plain = (value) => JSON.parse(JSON.stringify(value || []));
const catalogCache = new Map();
const cachedCatalogue = async (key, read) => {
  const previous = catalogCache.get(key);
  if (previous && previous.until > Date.now()) return previous.value;
  for (const [name, entry] of catalogCache)
    if (entry.until <= Date.now()) catalogCache.delete(name);
  if (catalogCache.size >= 256)
    catalogCache.delete(catalogCache.keys().next().value);
  const value = read();
  catalogCache.set(key, { until: Date.now() + 300000, value });
  try {
    return await value;
  } catch (error) {
    catalogCache.delete(key);
    throw error;
  }
};
const linksVersion = (links) =>
  createHash("sha256")
    .update(JSON.stringify(plain(links)))
    .digest("hex");
const ipNumber = (ip) =>
  ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
const cidrRange = (value) => {
  if (typeof value !== "string") fail("Укажите IPv4-подсеть");
  const [ip, prefix, ...rest] = value.split("/");
  if (
    rest.length ||
    !net.isIPv4(ip) ||
    !/^\d+$/.test(prefix || "") ||
    Number(prefix) > 32
  )
    fail("Укажите IPv4-подсеть");
  const size = 2 ** (32 - Number(prefix)),
    start = Math.floor(ipNumber(ip) / size) * size;
  const address = [24, 16, 8, 0]
    .map((shift) => Math.floor(start / 2 ** shift) % 256)
    .join(".");
  return { start, end: start + size, cidr: `${address}/${Number(prefix)}` };
};
const validateNetworkLinks = async (input, current = [], context = {}) => {
  const old = plain(current);
  if (input === undefined || JSON.stringify(input) === JSON.stringify(old))
    return old;
  if (
    !context.can?.({ settings: ["manage"] }) ||
    !context.can({ proxmox: ["manage"] }) ||
    !context.can({ mikrotik: ["read"] })
  )
    fail("Недостаточно прав для изменения сетевых связей", 403);
  if (!Array.isArray(input) || input.length > 256)
    fail("Укажите не более 256 сетевых связей");
  const result = [];
  for (const raw of input) {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (key) =>
          ![
            "_id",
            "connectionId",
            "routerId",
            "nodeName",
            "bridge",
            "vlan",
            "cidr",
            "lanInterface",
            "wan",
          ].includes(key),
      )
    )
      fail("Некорректная сетевая связь");
    for (const key of ["connectionId", "routerId"])
      if (typeof raw[key] !== "string" || !mongoose.isValidObjectId(raw[key]))
        fail("Некорректный идентификатор сетевой связи");
    if (raw._id && !mongoose.isValidObjectId(raw._id))
      fail("Некорректный идентификатор связи");
    if (
      raw.vlan != null &&
      (!Number.isInteger(raw.vlan) || raw.vlan < 1 || raw.vlan > 4094)
    )
      fail("VLAN должен быть от 1 до 4094");
    for (const key of ["nodeName", "bridge", "lanInterface"])
      if (
        typeof raw[key] !== "string" ||
        !raw[key].trim() ||
        raw[key].length > 100
      )
        fail("Выберите интерфейсы сетевой связи");
    if (
      !["interface", "list"].includes(raw.wan?.kind) ||
      typeof raw.wan?.name !== "string" ||
      !raw.wan.name.trim() ||
      raw.wan.name.length > 100
    )
      fail("Выберите внешний интерфейс MikroTik");
    const row = {
      _id: raw._id || String(new mongoose.Types.ObjectId()),
      connectionId: raw.connectionId,
      routerId: raw.routerId,
      nodeName: raw.nodeName,
      bridge: raw.bridge,
      vlan: raw.vlan ?? null,
      cidr: cidrRange(raw.cidr).cidr,
      lanInterface: raw.lanInterface,
      wan: { kind: raw.wan.kind, name: raw.wan.name },
    };
    const range = cidrRange(row.cidr);
    for (const previous of result) {
      if (previous._id === row._id) fail("Связь указана дважды");
      if (
        ["connectionId", "nodeName", "bridge", "vlan", "routerId"].every(
          (key) => previous[key] === row[key],
        )
      ) {
        const other = cidrRange(previous.cidr);
        if (range.start < other.end && other.start < range.end)
          fail("Пересекающиеся связи одного сегмента и роутера");
      }
    }
    const exists =
      context.lookups?.linkExists ||
      (async (link) => {
        const options = await getNetworkOptions(link, context);
        return (
          options.bridges.some((x) => x.value === link.bridge) &&
          options.interfaces.some((x) => x.value === link.lanInterface) &&
          options[
            link.wan.kind === "list" ? "interfaceLists" : "interfaces"
          ].some((x) => x.value === link.wan.name)
        );
      });
    if (!(await exists(row)))
      fail("Сеть или MikroTik недоступны. Обновите список интерфейсов");
    result.push(row);
  }
  return result;
};
const getNetworkOptions = async (input, access = {}) => {
  if (
    !access.can?.({ settings: ["manage"] }) ||
    !access.can({ proxmox: ["manage"] }) ||
    !access.can({ mikrotik: ["read"] })
  )
    fail("Недостаточно прав", 403);
  const { Connection, Resource } = require("../../../models/proxmox");
  const Router = require("../../../models/mikrotik");
  const prefs = await require("../../../models/preferences").findOne({}).lean();
  if (!require("./contract").enabled(prefs))
    fail("Включите модули Proxmox и MikroTik", 409);
  const [connections, routers] = await Promise.all([
    Connection.find({ archived: false, monitoringEnabled: true })
      .select("name")
      .lean(),
    Router.find({ monitoringEnabled: true }).select("name label").lean(),
  ]);
  const asOptions = (rows) =>
    rows.map((row) => ({
      value: String(row._id),
      label: row.label || row.name || "Без названия",
    }));
  const result = {
    connections: asOptions(connections),
    routers: asOptions(routers),
    nodes: [],
    bridges: [],
    interfaces: [],
    interfaceLists: [],
  };
  if (input.connectionId) {
    if (!result.connections.some((row) => row.value === input.connectionId))
      fail("Подключение недоступно", 404);
    const nodes = await Resource.find({
      connectionId: input.connectionId,
      kind: "node",
      archived: false,
    })
      .select("nodeName name")
      .lean();
    result.nodes = nodes.map((row) => ({
      value: row.nodeName,
      label: row.name || row.nodeName,
    }));
    if (input.nodeName) {
      if (!result.nodes.some((row) => row.value === input.nodeName))
        fail("Узел недоступен", 404);
      const connection = await Connection.findById(input.connectionId)
        .select("+tokenSecret")
        .lean();
      const rows = await cachedCatalogue(
        `pve:${input.connectionId}:${input.nodeName}`,
        () =>
          require("../transport").request(
            connection,
            `/nodes/${encodeURIComponent(input.nodeName)}/network`,
            { method: "GET", timeout: 5000 },
          ),
      );
      if (!Array.isArray(rows)) fail("Не удалось прочитать сети узла", 502);
      result.bridges = rows
        .filter((row) => /bridge/i.test(row.type || ""))
        .map((row) => ({ value: row.iface, label: row.iface }));
    }
  }
  if (input.routerId) {
    if (!result.routers.some((row) => row.value === input.routerId))
      fail("MikroTik недоступен", 404);
    const {
      RouterExposureSnapshot,
    } = require("../../../models/proxmoxExposure");
    let snapshot = await RouterExposureSnapshot.findOne({
      routerId: input.routerId,
    })
      .select("+data")
      .lean();
    if (!snapshot?.data || Date.now() - new Date(snapshot.checkedAt) > 300000) {
      const record = await Router.findById(input.routerId).lean();
      const raw = await cachedCatalogue(`router:${input.routerId}`, () =>
        require("../../mikrotik/exposure-snapshot").collectRouterSnapshot(
          record,
        ),
      );
      snapshot = { data: raw };
    }
    result.interfaces = (snapshot.data.interfaces || []).map((row) => ({
      value: row.name,
      label: row.name,
    }));
    result.interfaceLists = (snapshot.data.interfaceLists || []).map((row) => ({
      value: row.name,
      label: row.name,
    }));
  }
  return result;
};
const publicSettings = (settings, can) => {
  const result = plain(settings || {});
  if (!can?.({ mikrotik: ["read"] }) || !can?.({ proxmox: ["manage"] })) {
    delete result.networkLinks;
    delete result.networkLinksVersion;
  }
  return result;
};
module.exports = {
  validateNetworkLinks,
  linksVersion,
  cidrRange,
  getNetworkOptions,
  publicSettings,
};
