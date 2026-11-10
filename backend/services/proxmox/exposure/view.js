const { enabled } = require("./contract");
const { summaryOf } = require("./evaluate");
const { linksVersion } = require("./network-links");
const publicSummary = (resource, prefs, now = new Date()) => {
  if (
    !enabled(prefs) ||
    resource.template ||
    (resource.kind && resource.kind !== "guest")
  )
    return null;
  const stored = resource.exposure;
  const expected =
    prefs.proxmox?.networkLinksVersion ||
    linksVersion(prefs.proxmox?.networkLinks || []);
  const valid =
    stored &&
    !stored.invalidated &&
    stored.networkLinksVersion === expected &&
    stored.generation === (resource.exposureGeneration ?? stored.generation) &&
    resource.monitoringEnabled !== false &&
    !resource.monitoringPausedByConnection &&
    resource.connectionId?.monitoringEnabled !== false;
  const coverage = stored?.coverage?.map((row) =>
    valid ? row : { ...row, lastAttemptOk: false },
  ) || [
    {
      state: "unmatched",
      unknownCount: 1,
      lastAttemptOk: false,
      reasonCodes: ["networkUnmatched"],
    },
  ];
  const scan = stored?.securityCheckedAt
    ? {
        checkedAt: stored.securityCheckedAt,
        report: { severityCounts: stored.cveSeverityCounts, findingCount: stored.confirmedCveCount || 0 },
      }
    : null;
  const { coverage: _private, ...summary } = summaryOf(
    { coverage, checkedAt: stored?.checkedAt },
    scan,
    now,
    prefs,
  );
  if (
    coverage.some(
      (row) => row.freshUntil && +new Date(row.freshUntil) <= +now,
    ) &&
    !summary.reasonCodes.includes("routerSnapshotStale")
  )
    summary.reasonCodes.push("routerSnapshotStale");
  return { ...summary, generation: resource.exposureGeneration || 0 };
};
const publicDetail = (resource, record, access, prefs, now = new Date()) => {
  const summary = publicSummary(resource, prefs, now);
  const dto = { resourceId: String(resource._id || resource.id), summary };
  if (!summary || !access.canReadMikrotik) return dto;
  const report = record?.report;
  const current =
    !resource.exposure?.invalidated &&
    resource.monitoringEnabled !== false &&
    resource.connectionId?.monitoringEnabled !== false &&
    record?.generation ===
      (resource.exposureGeneration ?? record?.generation) &&
    resource.exposure?.networkLinksVersion ===
      (prefs.proxmox?.networkLinksVersion ||
        linksVersion(prefs.proxmox?.networkLinks || []));
  dto.publications = (report?.publications || []).map((row) => ({
    verdict: row.verdict,
    protocol: row.protocol,
    externalAddress: row.externalAddress,
    externalPorts: row.externalPorts,
    internalAddress: row.internalAddress,
    internalPorts: row.internalPorts,
    sourceAddresses: row.sourceAddresses,
    routerId: row.routerId,
    routerName: row.routerName,
    ruleId: row.ruleId,
    inInterface: row.inInterface,
    checkedAt: row.checkedAt,
    stale:
      !current ||
      resource.monitoringEnabled === false ||
      resource.connectionId?.monitoringEnabled === false ||
      row.stale ||
      !row.freshUntil ||
      +now >= +new Date(row.freshUntil),
  }));
  dto.sources = (report?.sources || []).map((row) => ({
    routerId: row.routerId,
    routerName: row.routerName,
    checkedAt: row.checkedAt,
    lastAttemptOk:
      current &&
      row.lastAttemptOk &&
      row.freshUntil &&
      +new Date(row.freshUntil) > +now,
    reasonCodes: (row.unresolved || []).map((reason) => reason.code),
  }));
  return dto;
};
module.exports = { publicSummary, publicDetail };
