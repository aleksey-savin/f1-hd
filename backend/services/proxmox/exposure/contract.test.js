const test = require("node:test");
const assert = require("node:assert/strict");
const {
  enabled,
  freshness,
  exposureRisk,
  TIMING,
  LIMITS,
} = require("./contract");
test("both modules are required, independently of ticket switches", () => {
  assert.equal(
    enabled({
      modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
    }),
    true,
  );
  assert.equal(enabled({ modules: { proxmox: { isActive: true } } }), false);
});
test("source freshness expires at 15 minutes or on failure/version change", () => {
  const input = {
    checkedAt: new Date(0),
    lastAttemptOk: true,
    versionMatches: true,
  };
  assert.equal(freshness(input, new Date(899999)), "fresh");
  assert.equal(freshness(input, new Date(900000)), "stale");
  assert.equal(
    freshness({ ...input, lastAttemptOk: false }, new Date(1)),
    "stale",
  );
  assert.equal(
    freshness({ ...input, versionMatches: false }, new Date(1)),
    "stale",
  );
  assert.equal(freshness({}, new Date()), "unknown");
  assert.equal(TIMING.POLL_MS, 300000);
  assert.equal(LIMITS.FRAGMENTS, 4096);
});
test("failed refresh retains a fresh completed CVE result including the 36 hour boundary", () => {
  const scan = {
    status: "error",
    checkedAt: new Date(0),
    report: {
      status: "partial",
      findings: [{ id: "CVE-a", severity: "high" }],
      reviewFindings: [{ id: "CVE-b" }],
    },
  };
  assert.deepEqual(exposureRisk(scan, new Date(36 * 3600000)), {
    confirmedCveCount: 1,
    securityCheckedAt: new Date(0),
    missingCheck: false,
  });
  assert.equal(
    exposureRisk(scan, new Date(36 * 3600000 + 1)).missingCheck,
    true,
  );
  assert.equal(
    exposureRisk({ status: "unsupported" }, new Date()).missingCheck,
    true,
  );
  assert.equal(exposureRisk(scan, new Date(1), { proxmox: { cveMinSeverity: 'critical' } }).confirmedCveCount, 0);
});
