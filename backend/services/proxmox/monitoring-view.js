const { Observation, GuestSecurity } = require("../../models/proxmox");
const { availabilityView } = require("./availability-view");
const { severityCountsProjection, applyCvePolicy } = require("./cve-policy");
const size = (path) => ({ $size: { $ifNull: [path, []] } });
const guestProjection = {
  resourceId: 1, status: 1, requestedAt: 1, checkedAt: 1, lastError: 1,
  report: {
    os: "$report.os", scope: "$report.scope", source: "$report.source",
    kernelCovered: "$report.kernelCovered", baselineCovered: "$report.baselineCovered", rebootRequired: "$report.rebootRequired",
    findingCount: size("$report.findings"), reviewCount: size("$report.reviewFindings"), updatesCount: size("$report.updates"),
    severityCounts: severityCountsProjection(),
    updates: { $map: {
      input: { $slice: [{ $filter: { input: { $ifNull: ["$report.updates", []] }, as: "update", cond: { $and: [{ $eq: ["$$update.security", true] }, { $eq: [size("$$update.cves"), 0] }] } } }, 3] },
      as: "update", in: { id: "$$update.id", title: "$$update.title", kb: "$$update.kb", security: "$$update.security" },
    } },
  },
};
// List responses expose counts and a few update notes, never vulnerability
// arrays, package inventory or worker state from the stored scan.
const guestSummary = (scan, prefs) => {
  const report = scan.report || {};
  return applyCvePolicy({
    status: scan.status, requestedAt: scan.requestedAt, checkedAt: scan.checkedAt, lastError: scan.lastError || null,
    os: report.os, scope: report.scope, source: report.source,
    kernelCovered: report.kernelCovered, baselineCovered: report.baselineCovered, rebootRequired: report.rebootRequired,
    findingCount: report.findingCount || 0, reviewCount: report.reviewCount || 0, updatesCount: report.updatesCount || 0,
    severityCounts: report.severityCounts,
    updates: (report.updates || []).slice(0, 3).map(({ id, title, kb, security }) => ({ id, title, kb, security })),
  }, prefs);
};
const enrich = async (items, now = new Date(), access = {}) => {
  const resources = items.filter((row) => ["node", "guest"].includes(row.kind));
  if (!resources.length) return items;
  const ids = resources.map((row) => row._id);
  const guestIds = resources.filter((row) => row.kind === "guest").map((row) => row._id);
  const nodeIds = resources.filter((row) => row.kind === "node").map((row) => row._id);
  const [observations, scans, nodeSecurity] = await Promise.all([
    Observation.find({ resourceId: { $in: ids }, from: { $lte: now }, $or: [{ until: { $gte: new Date(+now - 30 * 86400000) } }, { open: true }] }).lean(),
    guestIds.length ? GuestSecurity.aggregate([{ $match: { resourceId: { $in: guestIds } } }, { $project: guestProjection }]) : [],
    nodeIds.length ? require("./node-security").getSummaries(nodeIds, access.prefs) : new Map(),
  ]);
  const history = new Map();
  for (const row of observations) { const key = String(row.resourceId); if (!history.has(key)) history.set(key, []); history.get(key).push(row); }
  const guestScans = new Map(scans.map((scan) => [String(scan.resourceId), guestSummary(scan, access.prefs)]));
  let exposureRows = new Map();
  if (guestIds.length && require('./exposure/contract').enabled(access.prefs)) {
    const rows = await require('../../models/proxmox').Resource.find({ _id: { $in: guestIds } }).select('_id +exposure +exposureGeneration').lean();
    exposureRows = new Map(rows.map(row=>[String(row._id),row]));
  }
  return items.map((row) => {
    if (!["node", "guest"].includes(row.kind)) return row;
    const key = String(row._id);
    return {
      ...row, availability: availabilityView(row, history.get(key) || [], 30, now),
      ...(row.kind === "guest" ? { guestSecurity: guestScans.get(key) || null } : { nodeSecurity: nodeSecurity.get(key) || null }),
      ...(row.kind === 'guest' && require('./exposure/contract').enabled(access.prefs) ? { exposure:require('./exposure/view').publicSummary({...row,...exposureRows.get(key)},access.prefs,now) } : {}),
    };
  });
};
module.exports = { enrich, guestProjection };
