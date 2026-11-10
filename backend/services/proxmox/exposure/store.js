const { randomUUID } = require("node:crypto");
const { Resource, GuestSecurity } = require("../../../models/proxmox");
const { GuestExposure } = require("../../../models/proxmoxExposure");
const { summaryOf } = require("./evaluate");
const { exposureRisk } = require("./contract");
const { severityCounts } = require('../cve-policy');
const invalidateResources = async (scope, reason = "networkChanged") => {
  await Resource.updateMany(
    { kind: "guest", ...scope },
    {
      $inc: { exposureGeneration: 1 },
      $set: {
        "exposure.invalidated": true,
        "exposure.lastAttemptOk": false,
        "exposure.reasonCodes": [reason],
      },
    },
  );
  require("../core").bump();
};
const publishReport = async (resourceId, generation, inputVersions, report) => {
  const filter = {
    _id: resourceId,
    exposureGeneration: generation,
    monitoringEnabled: { $ne: false },
    archived: { $ne: true },
  };
  const resource = await Resource.findOne(filter)
    .select("+exposureGeneration")
    .lean();
  if (!resource) return false;
  if (
    !report.publications?.length &&
    report.coverage?.some(
      (row) => row.unknownCount || ["unknown", "unmatched"].includes(row.state),
    )
  ) {
    const old = await GuestExposure.findOne({ resourceId })
      .select("+report +inputVersions")
      .lean();
    if (
      inputVersions.guestIdentity &&
      old?.inputVersions?.guestIdentity === inputVersions.guestIdentity &&
      old.report?.publications?.length
    ) {
      report = {
        ...report,
        publications: old.report.publications.map((row) => ({
          ...row,
          stale: true,
        })),
        sources: [
          ...(report.sources || []),
          ...(old.report.sources || []).map((row) => ({
            ...row,
            lastAttemptOk: false,
          })),
        ],
      };
    }
  }
  const security = await GuestSecurity.findOne({ resourceId })
    .select("report checkedAt status")
    .lean();
  const summary = summaryOf(report, security);
  try {
    await GuestExposure.updateOne(
      {
        resourceId,
        $or: [{ generation: { $lte: generation } }, { generation: null }],
      },
      {
        $set: {
          generation,
          inputVersions,
          reportVersion: randomUUID(),
          checkedAt: report.checkedAt,
          freshUntil: summary.freshUntil,
          report,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
  const updated = await Resource.updateOne(filter, {
    $set: {
      exposure: {
        ...summary,
        cveSeverityCounts: severityCounts(security?.report?.findings),
        generation,
        networkLinksVersion: inputVersions.networkLinksVersion,
      },
    },
  });
  if (updated.matchedCount) require("../core").bump();
  return Boolean(updated.matchedCount);
};
const syncGuestRisk = async (resourceId) => {
  const scan = await GuestSecurity.findOne({ resourceId })
    .select("report checkedAt status")
    .lean();
  const risk = exposureRisk(scan);
  await Resource.updateOne(
    { _id: resourceId, "exposure.generation": { $exists: true } },
    {
      $set: {
        "exposure.securityCheckedAt": risk.securityCheckedAt,
        "exposure.confirmedCveCount": risk.confirmedCveCount,
        "exposure.cveSeverityCounts": severityCounts(scan?.report?.findings),
      },
    },
  );
  require("../core").bump();
};
module.exports = { invalidateResources, publishReport, syncGuestRisk };
