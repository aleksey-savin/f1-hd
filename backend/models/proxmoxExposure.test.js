const test = require("node:test");
const assert = require("node:assert/strict");
const Preferences = require("./preferences");
const { Resource } = require("./proxmox");
const { RouterExposureSnapshot, GuestExposure } = require("./proxmoxExposure");
test("new installations never enable exposure tickets or invent network links", () => {
  const prefs = new Preferences({});
  assert.equal(prefs.proxmox.exposureTicketsEnabled, false);
  assert.equal(prefs.proxmox.networkLinks.length, 0);
});
test("network snapshots and issue receipts are private and uniquely scoped", () => {
  assert.equal(Resource.schema.path("guestNetwork").options.select, false);
  assert.equal(Resource.schema.path("exposure").options.select, false);
  assert.equal(
    RouterExposureSnapshot.schema.path("data").options.select,
    false,
  );
  assert.equal(GuestExposure.schema.path("report").options.select, false);
  assert.equal(GuestExposure.schema.path("issue").options.select, false);
  assert.ok(
    RouterExposureSnapshot.schema
      .indexes()
      .some(([keys, opt]) => keys.routerId === 1 && opt.unique),
  );
  assert.ok(
    GuestExposure.schema
      .indexes()
      .some(([keys, opt]) => keys.resourceId === 1 && opt.unique),
  );
});
