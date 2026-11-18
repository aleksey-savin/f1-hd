const { fail } = require("../policy");
const { linksVersion, validateNetworkLinks } = require("./network-links");
const { isDeepStrictEqual } = require("node:util");
const plain = (value) => JSON.parse(JSON.stringify(value));
const { nodeScope, belongsToNode } = require("./scope");
const requireNetworkAccess = (access) => {
  if (
    access?.isEndUser ||
    !access?.can?.({ proxmox: ["read"] }) ||
    !access.can({ proxmox: ["manage"] }) ||
    !access.can({ mikrotik: ["read"] })
  )
    fail("Недостаточно прав для изменения сетевых связей", 403);
};
const prepareNodeLinks = async (node, input, current, access) => {
  requireNetworkAccess(access);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["revision", "links"].includes(key)) ||
    !Array.isArray(input.links) ||
    input.links.length > 256
  )
    fail("Укажите список сетевых связей");
  if (input.revision !== linksVersion(current))
    fail("Связи изменились. Обновите форму перед сохранением.", 409);
  const existing = plain(current).filter((link) => belongsToNode(link, node));
  const others = plain(current).filter((link) => !belongsToNode(link, node));
  const scoped = input.links.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some(
        (key) =>
          ![
            "_id",
            "routerId",
            "bridge",
            "vlan",
            "cidr",
            "lanInterface",
            "wan",
          ].includes(key),
      )
    )
      fail("Недопустимые поля сетевой связи");
    if (row._id && !existing.some((old) => old._id === row._id))
      fail("Связь не принадлежит этому узлу", 409);
    return { ...row, ...nodeScope(node) };
  });
  // Validate changed mappings live; unchanged mappings can survive a router outage.
  const validated = await validateNetworkLinks(scoped, existing, {
    ...access,
    lookups: {
      linkExists: async (link) => {
        if (existing.some((old) => isDeepStrictEqual(old, link))) return true;
        if (access.lookups?.linkExists) return access.lookups.linkExists(link);
        const options = await require("./network-links").getNetworkOptions(
          link,
          access,
        );
        return (
          options.bridges.some((row) => row.value === link.bridge) &&
          options.interfaces.some((row) => row.value === link.lanInterface) &&
          options[
            link.wan.kind === "list" ? "interfaceLists" : "interfaces"
          ].some((row) => row.value === link.wan.name)
        );
      },
    },
  });
  if (others.length + validated.length > 256)
    fail("Укажите не более 256 сетевых связей");
  return [...others, ...validated];
};
const loadNodeContext = async (id, access) => {
  requireNetworkAccess(access);
  const { validId } = require("../view");
  const { Resource } = require("../../../models/proxmox");
  const Preferences = require("../../../models/preferences");
  const node = await Resource.findOne({
    _id: validId(id),
    kind: "node",
    archived: false,
  }).lean();
  if (!node) fail("Узел не найден", 404);
  const prefs = await Preferences.findOne({}).lean();
  if (!require("./contract").enabled(prefs))
    fail("Включите модули Proxmox и MikroTik", 409);
  return { node, prefs, links: plain(prefs.proxmox?.networkLinks || []) };
};
const readNodeLinks = async (id, access) => {
  const { node, links } = await loadNodeContext(id, access);
  const ownLinks = links.filter((link) => belongsToNode(link, node));
  let options;
  try {
    options = await require("./node-network-discovery").getNodeNetworkOptions(
      node,
    );
  } catch (error) {
    if (!ownLinks.length) throw error;
    // Existing links must remain removable even when their devices are offline.
    options = {
      networks: [],
      routers: [],
      warnings: [
        "Не удалось обновить сети узла. Сохранённые связи доступны для удаления.",
      ],
    };
  }
  const missingIds = [
    ...new Set(ownLinks.map((link) => String(link.routerId))),
  ].filter((id) => !options.routers.some((router) => router.id === id));
  if (missingIds.length) {
    const devices = await require("../../../models/mikrotik")
      .find({ _id: { $in: missingIds } })
      .select("name label credentials.host")
      .lean();
    options.routers.push(
      ...missingIds.map((id) => {
        const device = devices.find((row) => String(row._id) === id);
        return {
          id,
          name:
            device?.label || device?.name || "Недоступное сетевое устройство",
          address: device?.credentials?.host || "",
          matches: [],
          wanOptions: [],
          error:
            "Устройство недоступно для новых связей. Сохранённые связи можно удалить.",
        };
      }),
    );
  }
  return {
    ...options,
    node: {
      id: String(node._id),
      name: node.name || node.nodeName,
      ...nodeScope(node),
    },
    links: ownLinks,
    revision: linksVersion(links),
  };
};
const saveNodeLinks = async (id, input, access) => {
  const { node, prefs, links } = await loadNodeContext(id, access);
  const next = await prepareNodeLinks(node, input, links, access);
  const version = linksVersion(next);
  if (version === linksVersion(links)) return { ok: true };
  const Preferences = require("../../../models/preferences");
  const updated = await Preferences.updateOne(
    {
      _id: prefs._id,
      "proxmox.networkLinks": prefs.proxmox?.networkLinks ?? { $exists: false },
    },
    {
      $set: {
        "proxmox.networkLinks": next,
        "proxmox.networkLinksVersion": version,
      },
    },
  );
  if (!updated.matchedCount)
    fail("Связи изменились. Обновите форму перед сохранением.", 409);
  await require("./store").invalidateResources(
    nodeScope(node),
    "networkLinksChanged",
  );
  await require("../core").event(
    node,
    "networkLinksChanged",
    "Изменены связи узла с сетевыми устройствами",
    access.userId,
  );
  return { ok: true };
};
module.exports = {
  requireNetworkAccess,
  prepareNodeLinks,
  nodeScope,
  belongsToNode,
  loadNodeContext,
  readNodeLinks,
  saveNodeLinks,
};
