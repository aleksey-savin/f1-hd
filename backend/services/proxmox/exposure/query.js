const { enabled, TIMING } = require("./contract");
const { nodeScope, nodeLinksVersion } = require("./scope");
const { fail } = require("../policy");
const { minSeverity } = require('../cve-policy');
const applyExposureFilter = (
  filter,
  value,
  { prefs, now = new Date(), disabledConnectionIds = [] } = {},
) => {
  if (!value || !enabled(prefs)) return;
  if (!["published", "restricted", "attention", "none"].includes(value))
    fail("Неизвестный фильтр доступа из интернета");
  const add = (condition) => (filter.$and ||= []).push(condition);
  add({ template: { $ne: true } });
  // A report only describes the current configuration of its own node.
  const links = prefs.proxmox?.networkLinks || [];
  const scopes = [...new Map(links.map(link => {
    const scope = nodeScope(link);
    return [JSON.stringify(scope), {
      ...scope, 'exposure.networkLinksVersion': nodeLinksVersion(links, scope),
    }];
  })).values()];
  add(scopes.length ? { $or: scopes } : { _id: { $in: [] } });
  add({ 'exposure.coverage.0': { $exists: true } });
  const fresh = { lastAttemptOk: { $ne: false }, freshUntil: { $gt: now } };
  const positive = {
    ...fresh,
    $or: [{ hasPublic: true }, { hasRestricted: true }],
  };
  const valid = {
    "exposure.invalidated": { $ne: true },
    monitoringEnabled: { $ne: false },
  };
  if (disabledConnectionIds.length)
    valid.connectionId = { $nin: disabledConnectionIds };
  if (value === "published" || value === "restricted") {
    add({
      ...valid,
      "exposure.coverage": {
        $elemMatch:
          value === "restricted" ? { ...fresh, hasRestricted: true } : positive,
      },
    });
    return;
  }
  if (value === "none") {
    add({
      ...valid,
      "exposure.state": "none",
      "exposure.lastAttemptOk": true,
      "exposure.freshUntil": { $gt: now },
    });
    return;
  }
  const missing = {
    $or: [
      { "exposure.securityCheckedAt": null },
      {
        "exposure.securityCheckedAt": {
          $lt: new Date(+now - TIMING.SECURITY_MS),
        },
      },
      { "exposure.cveSeverityCounts.critical": { $gt: 0 } },
      ...(minSeverity(prefs) === 'high' ? [{ "exposure.cveSeverityCounts.high": { $gt: 0 } }] : []),
    ],
  };
  add({
    $or: [
      { "exposure.invalidated": true },
      { monitoringEnabled: false },
      ...(disabledConnectionIds.length
        ? [{ connectionId: { $in: disabledConnectionIds } }]
        : []),
      {
        "exposure.coverage": {
          $elemMatch: {
            $or: [
              { unknownCount: { $gt: 0 } },
              { state: { $in: ["unknown", "unmatched"] } },
              { lastAttemptOk: false },
              { freshUntil: { $lte: now } },
            ],
          },
        },
      },
      {
        $and: [
          valid,
          { "exposure.coverage": { $elemMatch: positive } },
          missing,
        ],
      },
    ],
  });
};
module.exports = { applyExposureFilter };
