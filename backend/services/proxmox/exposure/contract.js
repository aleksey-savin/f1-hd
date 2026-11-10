const TIMING = Object.freeze({
  POLL_MS: 300000,
  STALE_MS: 900000,
  SECURITY_MS: 36 * 3600000,
  LEASE_MS: 240000,
});
const LIMITS = Object.freeze({
  ROWS: 20000,
  BYTES: 8 * 1024 * 1024,
  JUMPS: 32,
  FRAGMENTS: 4096,
});
const { applyCvePolicy } = require('../cve-policy');
const enabled = (prefs) =>
  Boolean(
    prefs?.modules?.proxmox?.isActive && prefs?.modules?.mikrotik?.isActive,
  );
const freshness = (
  { checkedAt, lastAttemptOk, versionMatches } = {},
  now = new Date(),
) => {
  if (checkedAt == null || !Number.isFinite(+new Date(checkedAt)))
    return "unknown";
  return lastAttemptOk === false ||
    versionMatches === false ||
    +now - new Date(checkedAt) >= TIMING.STALE_MS
    ? "stale"
    : "fresh";
};
const exposureRisk = (scan, now = new Date(), prefs) => {
  const hasReport = Boolean(scan?.report && scan.checkedAt != null);
  return {
    confirmedCveCount:
      applyCvePolicy(scan?.report, prefs)?.alertFindingCount || 0,
    securityCheckedAt: hasReport ? new Date(scan.checkedAt) : null,
    missingCheck:
      !hasReport || +now - new Date(scan.checkedAt) > TIMING.SECURITY_MS,
  };
};
module.exports = { TIMING, LIMITS, enabled, freshness, exposureRisk };
