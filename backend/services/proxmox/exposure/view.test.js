const test = require("node:test");
const assert = require("node:assert/strict");
const { publicSummary, publicDetail } = require("./view");
const prefs = {
  modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
  proxmox: { networkLinksVersion: "v" },
};
const resource = {
  _id: "g",
  exposureGeneration: 1,
  exposure: {
    generation: 1,
    networkLinksVersion: "v",
    securityCheckedAt: new Date(0),
    confirmedCveCount: 2,
    coverage: [
      {
        state: "public",
        hasPublic: true,
        publishedCount: 1,
        checkedAt: new Date(0),
        freshUntil: new Date(900000),
        lastAttemptOk: true,
      },
    ],
  },
};
test("public summary dynamically expires while detailed network data requires MikroTik rights", () => {
  assert.equal(publicSummary(resource, prefs, new Date(1)).hasPublic, true);
  assert.equal(
    publicSummary(resource, prefs, new Date(900000)).hasPublic,
    false,
  );
  const report = {
    generation: 1,
    report: {
      publications: [{ internalAddress: "private", routerId: "secret" }],
      sources: [{ routerId: "secret" }],
    },
  };
  const dto = publicDetail(
    resource,
    report,
    { canReadMikrotik: false },
    prefs,
    new Date(1),
  );
  assert.doesNotMatch(JSON.stringify(dto), /private|secret|coverage|routerId/);
  assert.equal(dto.resourceId, "g");
  assert.equal(publicSummary(resource, { modules: {} }, new Date()), null);
});
test("expired first source does not hide another fresh source or claim full coverage", () => {
  const second = {
    ...resource,
    exposure: {
      ...resource.exposure,
      coverage: [
        ...resource.exposure.coverage,
        {
          state: "restricted",
          hasRestricted: true,
          publishedCount: 1,
          freshUntil: new Date(1800000),
          lastAttemptOk: true,
        },
      ],
    },
  };
  const result = publicSummary(second, prefs, new Date(900000));
  assert.equal(result.hasRestricted, true);
  assert.equal(result.hasPublic, false);
  assert.equal(result.publishedCount, 1);
  assert.ok(result.unknownCount);
});
test("publication TTL includes guest evidence, not just a newer router timestamp", () => {
  const item = {
    ...resource,
    exposure: {
      ...resource.exposure,
      coverage: [
        { ...resource.exposure.coverage[0], checkedAt: new Date(840000) },
      ],
    },
  };
  const report = {
    generation: 1,
    report: {
      publications: [
        {
          routerId: "r",
          linkId: "l",
          checkedAt: new Date(840000),
          freshUntil: new Date(900000),
        },
      ],
    },
  };
  const dto = publicDetail(
    item,
    report,
    { canReadMikrotik: true },
    prefs,
    new Date(960000),
  );
  assert.equal(dto.summary.publishedCount, 0);
  assert.equal(dto.publications[0].stale, true);
});
