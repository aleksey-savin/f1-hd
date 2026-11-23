const { isDeniedAccount } = require("../accountDenial");
const { redactSecrets } = require("../secretsScanner");

// Keep authorization injectable: revocation, deleted owners and disabled modules
// are tested without connecting to Mongo or loading the application's logger.
const createResolveActor = ({ getKey, getOwner, enabled, canFor }) => async (keyId, scope) => {
  if (!keyId || !(await enabled())) return null;
  const key = await getKey(keyId);
  if (!key?.scopes?.includes(scope) || !key.createdBy) return null;
  const owner = await getOwner(key.createdBy);
  if (!owner || owner.isEndUser !== false || isDeniedAccount(owner)) return null;
  const can = await canFor(owner);
  if (!can({ proxmox: ["read"] }) || (scope === "proxmoxWrite" && !can({ proxmox: ["manage"] }))) return null;
  return { userId: key.createdBy, mcpKeyId: keyId, scopes: key.scopes, can };
};

const resolveActor = createResolveActor({
  getKey: (id) => require("../../models/mcpKey").findById(id).select("scopes createdBy").lean(),
  getOwner: (id) => require("../../models/user").findById(id).populate("company._id", "isActive").lean().then((owner) => {
    if (owner?.company?._id?.isActive === false) owner.company.isActive = false;
    return owner;
  }),
  enabled: async () => Boolean((await require("../../models/preferences").findOne({}).select("modules.proxmox").lean())?.modules?.proxmox?.isActive),
  canFor: (owner) => require("../permissions").canFor(owner),
});

const kinds = { node: "nodes", guest: "guests", storage: "storages" };
const read = () => require("../proxmox/view");
const fields = ["id", "kind", "name", "nodeName", "vmid", "guestType", "company", "companyId", "connection", "connectionId", "node", "status", "freshness", "lastCheckedAt", "lastSuccessfulConnectionAt", "resources", "expectedRunning", "template", "shared", "storageType", "missingSince", "archived", "createdAt", "updatedAt", "lastBackupAt"];
const safeText = (value) => redactSecrets(String(value).slice(0, 2000)).text;
const publicRow = (row) => ({
  ...Object.fromEntries(fields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])),
  ...(row.title ? { title: safeText(row.title) } : {}),
});
const publicList = ({ items, total, page, pageSize }) => ({
  items: items.map(publicRow), total, page, pageSize,
});
const publicDetail = (result, access = {}) => ({
  item: {
    ...publicRow(result.item),
    ...(access.management ? {
      monitoringEnabled: result.item.monitoringEnabled,
      maintenance: result.item.maintenance?.until
        ? { from: result.item.maintenance.from, until: result.item.maintenance.until } : null,
    } : {}),
    ...(access.inventory && result.item.kind === "node" ? { clientDeviceId: result.item.clientDeviceId ?? null } : {}),
  },
  related: Object.fromEntries(["guests", "nodes", "storages"].map((kind) => [kind, (result.related?.[kind] || []).map(publicRow)])),
});
const list = async ({ kind, ...query }) => {
  if (!kinds[kind]) throw new Error("Unknown Proxmox resource kind");
  return publicList(await read().list(kinds[kind], query));
};
const detail = async ({ id }, access) => {
  read().validId(id);
  const resource = await require("../../models/proxmox").Resource.findById(id).select("kind").lean();
  if (!resource || !kinds[resource.kind]) return { item: null };
  const result = await read().detail(kinds[resource.kind], id);
  return publicDetail(result, access);
};
const metrics = ({ id, timeframe }) => read().metrics(id, timeframe || "day");
const events = async ({ id, ...query }) => {
  const result = await read().events(id, query);
  return { ...result, items: result.items.map((row) => ({ id: row.id, kind: row.kind, message: row.message ? safeText(row.message) : undefined, createdAt: row.createdAt, companyId: row.companyId, resourceId: row.resourceId })) };
};

module.exports = { createResolveActor, resolveActor, publicRow, publicList, publicDetail, list, detail, metrics, events };
