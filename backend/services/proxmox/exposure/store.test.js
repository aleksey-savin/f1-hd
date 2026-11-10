const test = require("node:test");
const assert = require("node:assert/strict");
const { Resource } = require("../../../models/proxmox");
const { GuestExposure } = require("../../../models/proxmoxExposure");
const { publishReport } = require("./store");
const { GuestSecurity } = require("../../../models/proxmox");
const core = require("../core");
test("old worker cannot publish across generation or guest replacement", async (t) => {
  let generation = 2,
    report;
  t.mock.method(Resource, "findOne", (filter) => ({
    select() {
      return this;
    },
    lean: async () =>
      filter.exposureGeneration === generation
        ? { _id: "g", exposureGeneration: generation }
        : null,
  }));
  t.mock.method(GuestExposure, "updateOne", async (_filter, patch) => {
    report = patch;
    return { matchedCount: 1 };
  });
  t.mock.method(Resource, "updateOne", async (filter) => ({
    matchedCount: filter.exposureGeneration === generation ? 1 : 0,
  }));
  assert.equal(await publishReport("g", 1, {}, { coverage: [] }), false);
  assert.equal(report, undefined);
});
test("lost address evidence retains historical publications only for the same guest identity", async (t) => {
  let stored;
  t.mock.method(Resource, "findOne", () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: "g" }),
  }));
  t.mock.method(GuestSecurity, "findOne", () => ({
    select() {
      return this;
    },
    lean: async () => null,
  }));
  t.mock.method(GuestExposure, "findOne", () => ({
    select() {
      return this;
    },
    lean: async () => ({
      inputVersions: { guestIdentity: "same" },
      report: {
        publications: [{ ruleId: "old", checkedAt: new Date(0) }],
        sources: [],
      },
    }),
  }));
  t.mock.method(GuestExposure, "updateOne", async (_filter, patch) => {
    stored = patch.$set.report;
    return { matchedCount: 1 };
  });
  t.mock.method(Resource, "updateOne", async () => ({ matchedCount: 1 }));
  t.mock.method(core, "bump", () => {});
  await publishReport(
    "g",
    1,
    { guestIdentity: "same" },
    {
      coverage: [{ state: "unknown", unknownCount: 1 }],
      publications: [],
      sources: [],
    },
  );
  assert.equal(stored.publications[0].stale, true);
  await publishReport(
    "g",
    1,
    { guestIdentity: "replacement" },
    {
      coverage: [{ state: "unknown", unknownCount: 1 }],
      publications: [],
      sources: [],
    },
  );
  assert.equal(stored.publications.length, 0);
});
