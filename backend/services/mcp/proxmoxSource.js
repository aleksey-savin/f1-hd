const { isDeniedAccount } = require("../accountDenial");
const { redactSecrets } = require("../secretsScanner");

// Keep authorization injectable: revocation, deleted owners and disabled modules
// are tested without connecting to Mongo or loading the application's logger.
const createAuthorize = ({ getKey, getOwner, enabled, canFor }) => async (keyId) => {
  if (!keyId || !(await enabled())) return false;
  const key = await getKey(keyId);
  if (!key?.scopes?.includes("proxmox") || !key.createdBy) return false;
  const owner = await getOwner(key.createdBy);
  if (!owner || owner.isEndUser !== false || isDeniedAccount(owner)) return false;
  return Boolean((await canFor(owner))({ proxmox: ["read"] }));
};

const authorize = createAuthorize({
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
const publicList = (result) => ({ ...result, items: result.items.map(publicRow) });
const publicDetail = (result) => ({
  item: publicRow(result.item),
  related: Object.fromEntries(["guests", "nodes", "storages"].map((kind) => [kind, (result.related?.[kind] || []).map(publicRow)])),
});
const list = async ({ kind, ...query }) => {
  if (!kinds[kind]) throw new Error("Unknown Proxmox resource kind");
  return publicList(await read().list(kinds[kind], query));
};
const detail = async ({ id }) => {
  read().validId(id);
  const resource = await require("../../models/proxmox").Resource.findById(id).select("kind").lean();
  if (!resource || !kinds[resource.kind]) return { item: null };
  const result = await read().detail(kinds[resource.kind], id);
  return publicDetail(result);
};
const metrics = ({ id, timeframe }) => read().metrics(id, timeframe || "day");
const events = async ({ id, ...query }) => {
  const result = await read().events(id, query);
  return { ...result, items: result.items.map((row) => ({ id: row.id, kind: row.kind, message: row.message ? safeText(row.message) : undefined, createdAt: row.createdAt, companyId: row.companyId, resourceId: row.resourceId })) };
};

module.exports = { createAuthorize, authorize, publicRow, publicDetail, list, detail, metrics, events };
