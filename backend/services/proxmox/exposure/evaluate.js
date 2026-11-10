const { evaluatePath } = require("./firewall");
const { TIMING, LIMITS, freshness, exposureRisk } = require("./contract");
const evaluateTargets = (
  { guestTargets, routerSnapshots },
  now = new Date(),
) => {
  const publications = [],
    sources = [],
    coverage = [];
  const budget = {
    operations: 0,
    maxOperations: 200000,
    fragments: LIMITS.FRAGMENTS,
    jumps: LIMITS.JUMPS,
  };
  for (const reason of [...new Map(guestTargets.unresolved.map(row=>[row.code,row])).values()])
    coverage.push({
      state: reason.code === "networkUnmatched" ? "unmatched" : "unknown",
      unknownCount: 1,
      lastAttemptOk: false,
      reasonCodes: [reason.code],
    });
  for (const target of guestTargets.targets) {
    if (
      coverage.length >= LIMITS.FRAGMENTS || publications.length >= LIMITS.FRAGMENTS ||
      budget.operations >= budget.maxOperations
    ) {
      coverage.push({
        state: "unknown",
        unknownCount: 1,
        lastAttemptOk: false,
        reasonCodes: ["analysisLimit"],
      });
      break;
    }
    const snapshot = routerSnapshots.find(
      (row) => String(row.routerId) === String(target.link.routerId),
    );
    const fresh =
      freshness(
        {
          checkedAt: snapshot?.checkedAt,
          lastAttemptOk: snapshot?.status === "fresh",
          versionMatches: true,
        },
        now,
      ) === "fresh";
    const source = {
      routerId: String(target.link.routerId),
      routerName: snapshot?.routerName,
      linkId: String(target.link._id),
      checkedAt: snapshot?.checkedAt,
      lastAttemptOk: fresh,
      freshUntil: snapshot?.checkedAt
        ? new Date(
            Math.min(
              +new Date(snapshot.checkedAt) + TIMING.STALE_MS,
              +new Date(target.networkCheckedAt) + TIMING.STALE_MS,
            ),
          )
        : null,
    };
    sources.push(source);
    if (!snapshot?.data) {
      coverage.push({
        state: "unknown",
        unknownCount: 1,
        lastAttemptOk: false,
        reasonCodes: ["routerSnapshotMissing"],
      });
      continue;
    }
    budget.fragments = Math.max(1, LIMITS.FRAGMENTS - publications.length);
    const result = evaluatePath(snapshot.data, target, {
      sharedBudget: budget,
    });
    const rows = result.fragments.map((row) => ({
      ...row,
      routerId: source.routerId,
      routerName: source.routerName,
      linkId: source.linkId,
      checkedAt: snapshot.checkedAt,
      stale: !fresh,
      freshUntil: new Date(
        Math.min(
          +new Date(snapshot.checkedAt) + TIMING.STALE_MS,
          +new Date(target.networkCheckedAt) + TIMING.STALE_MS,
        ),
      ),
    }));
    publications.push(...rows);
    const publicCount = rows.filter((row) => row.verdict === "public").length,
      restrictedCount = rows.filter(
        (row) => row.verdict === "restricted",
      ).length;
    const state = publicCount
      ? "public"
      : restrictedCount
        ? "restricted"
        : result.unresolved.length
          ? "unknown"
          : rows.length
            ? "blocked"
            : "none";
    coverage.push({
      state,
      hasPublic: publicCount > 0,
      hasRestricted: restrictedCount > 0,
      publishedCount: publicCount + restrictedCount,
      blockedCount: rows.filter((row) => row.verdict === "blocked").length,
      unknownCount: result.unresolved.length || (!fresh ? 1 : 0),
      checkedAt: snapshot.checkedAt,
      freshUntil: new Date(
        Math.min(
          +new Date(snapshot.checkedAt) + TIMING.STALE_MS,
          +new Date(target.networkCheckedAt) + TIMING.STALE_MS,
        ),
      ),
      lastAttemptOk: fresh,
      reasonCodes: [
        ...new Set(result.unresolved.map((row) => row.code)),
        ...(!fresh ? ["routerSnapshotStale"] : []),
      ],
    });
    source.unresolved = result.unresolved;
  }
  if (!coverage.length)
    coverage.push({
      state: "unmatched",
      unknownCount: 1,
      lastAttemptOk: false,
      reasonCodes: ["networkUnmatched"],
    });
  return { coverage, publications, sources, checkedAt: now };
};
const summaryOf = (report, scan, now = new Date(), prefs) => {
  const coverage = report?.coverage || [];
  const fresh = (row) =>
    row.lastAttemptOk !== false &&
    row.freshUntil &&
    +new Date(row.freshUntil) > +now;
  const current = coverage.filter(fresh);
  const hasPublic = current.some((row) => row.hasPublic),
    hasRestricted = current.some((row) => row.hasRestricted);
  const unknownCount = coverage.reduce(
    (n, row) =>
      n + (row.unknownCount || 0) + (!fresh(row) && !row.unknownCount ? 1 : 0),
    0,
  );
  const state = hasPublic
    ? "public"
    : hasRestricted
      ? "restricted"
      : coverage.some((row) => row.state === "unmatched")
        ? "unmatched"
        : unknownCount
          ? "unknown"
          : current.some((row) => row.state === "blocked")
            ? "blocked"
            : "none";
  const risk = exposureRisk(scan, now, prefs);
  return {
    state,
    hasPublic,
    hasRestricted,
    publishedCount: current.reduce(
      (n, row) => n + (row.publishedCount || 0),
      0,
    ),
    blockedCount: current.reduce((n, row) => n + (row.blockedCount || 0), 0),
    unknownCount,
    checkedAt: report?.checkedAt || null,
    freshUntil:
      coverage.length && coverage.every(fresh)
        ? new Date(
            Math.min(...coverage.map((row) => +new Date(row.freshUntil))),
          )
        : null,
    lastAttemptOk: coverage.length > 0 && coverage.every(fresh),
    reasonCodes: [...new Set(coverage.flatMap((row) => row.reasonCodes || []))],
    ...risk,
    needsAttention: Boolean(
      unknownCount ||
        state === "unmatched" ||
        ((hasPublic || hasRestricted) &&
          (risk.confirmedCveCount || risk.missingCheck)),
    ),
    coverage,
  };
};
module.exports = { evaluateTargets, summaryOf };
