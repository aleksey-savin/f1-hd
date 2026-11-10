const test = require("node:test");
const assert = require("node:assert/strict");
const sift = require("sift").default;
const { applyExposureFilter } = require("./query");
const prefs = {
  modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
  proxmox: { networkLinksVersion: "v" },
};
test("publication filters use source TTL at query time and preserve prior search clauses", () => {
  const now = new Date(1000),
    filter = { $or: [{ name: "g" }] };
  applyExposureFilter(filter, "published", { prefs, now });
  const resource = {
    name: "g",
    template: false,
    monitoringEnabled: true,
    exposure: {
      networkLinksVersion: "v",
      coverage: [
        { hasPublic: true, lastAttemptOk: true, freshUntil: new Date(2000) },
      ],
    },
  };
  assert.equal(sift(filter)(resource), true);
  resource.exposure.coverage[0].freshUntil = now;
  assert.equal(sift(filter)(resource), false);
  const off = {};
  applyExposureFilter(off, "published", { prefs: { modules: {} }, now });
  assert.deepEqual(off, {});
});
test('attention filter follows the current severity without waiting for a NAT poll', () => {
  const { publicSummary } = require('./view');
  const now = new Date(1000);
  const resource = { kind: 'guest', exposureGeneration: 1, exposure: {
    generation: 1, networkLinksVersion: 'v', securityCheckedAt: now,
    cveSeverityCounts: { high: 2, critical: 0, unknown: 8 }, confirmedCveCount: 10,
    coverage: [{ state: 'public', hasPublic: true, publishedCount: 1, lastAttemptOk: true, freshUntil: new Date(2000) }],
  } };
  for (const [severity, expected, count] of [['high', true, 2], ['critical', false, 0]]) {
    const settings = { ...prefs, proxmox: { ...prefs.proxmox, cveMinSeverity: severity } };
    const filter = {};
    applyExposureFilter(filter, 'attention', { prefs: settings, now });
    assert.equal(sift(filter)(resource), expected);
    const summary = publicSummary(resource, settings, now);
    assert.equal(summary.confirmedCveCount, count);
    assert.equal(summary.needsAttention, expected);
  }
});
