// node --test services/mikrotik/license.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseDeviceDate, parseLicense, licenseView } = require("./license");

const NOW = new Date("2026-10-09T12:00:00Z");

test("device dates: both RouterOS formats, garbage is null", () => {
  assert.equal(
    parseDeviceDate("may/10/2016 21:59:59").toISOString(),
    "2016-05-10T21:59:59.000Z",
  );
  assert.equal(
    parseDeviceDate("2026-11-14 08:00:00").toISOString(),
    "2026-11-14T08:00:00.000Z",
  );
  assert.equal(parseDeviceDate("sep/02/2026").toISOString(), "2026-09-02T00:00:00.000Z");
  assert.equal(parseDeviceDate(""), null);
  assert.equal(parseDeviceDate("soon"), null);
  assert.equal(parseDeviceDate("xyz/01/2026"), null);
});

test("RouterBOARD reply: nlevel and software-id", () => {
  assert.deepEqual(
    parseLicense([{ "software-id": "7XQ4-9BLT", nlevel: "4", features: "" }]),
    {
      level: "4",
      softwareId: "7XQ4-9BLT",
      systemId: null,
      deadlineAt: null,
      nextRenewalAt: null,
      limitedUpgrades: false,
    },
  );
});

test("CHR reply: level, system-id, dates, limited-upgrades", () => {
  const license = parseLicense([
    {
      "system-id": "kR7xQ2mLp9A",
      level: "p1",
      "next-renewal-at": "aug/03/2026 10:00:00",
      "deadline-at": "sep/02/2026 10:00:00",
      "limited-upgrades": "true",
    },
  ]);
  assert.equal(license.level, "p1");
  assert.equal(license.systemId, "kR7xQ2mLp9A");
  assert.equal(license.deadlineAt.toISOString(), "2026-09-02T10:00:00.000Z");
  assert.equal(license.limitedUpgrades, true);
});

test("no rows or no level: nothing to store", () => {
  assert.equal(parseLicense(null), null);
  assert.equal(parseLicense([]), null);
  assert.equal(parseLicense([{ "software-id": "AAAA-BBBB" }]), null);
});

test("view: not read yet is null", () => {
  assert.equal(licenseView({}, NOW), null);
  assert.equal(licenseView(null, NOW), null);
});

test("view: RouterBOARD levels are perpetual, demo levels are inactive", () => {
  const view = licenseView({ license: { level: "4", softwareId: "7XQ4-9BLT" } }, NOW);
  assert.equal(view.kind, "routeros");
  assert.equal(view.label, "L4");
  assert.equal(view.state, "ok");
  assert.equal(view.softwareId, "7XQ4-9BLT");
  assert.equal(licenseView({ license: { level: "1" } }, NOW).state, "inactive");
  assert.equal(licenseView({ license: { level: "0" } }, NOW).state, "inactive");
});

test("view: CHR Free is inactive", () => {
  const view = licenseView({ license: { level: "free" } }, NOW);
  assert.equal(view.label, "CHR Free");
  assert.equal(view.state, "inactive");
});

test("view: CHR past its deadline or with limited upgrades is expired", () => {
  const past = { level: "p1", deadlineAt: new Date("2026-09-02T10:00:00Z") };
  assert.equal(licenseView({ license: past }, NOW).state, "expired");
  const limited = {
    level: "p10",
    deadlineAt: new Date("2026-12-01T00:00:00Z"),
    limitedUpgrades: true,
  };
  assert.equal(licenseView({ license: limited }, NOW).state, "expired");
});

test("view: valid CHR carries the deadline, flagged when close", () => {
  const far = licenseView(
    { license: { level: "p1", deadlineAt: new Date("2026-11-14T00:00:00Z") } },
    NOW,
  );
  assert.equal(far.state, "ok");
  assert.equal(far.soon, false);
  assert.equal(far.until.toISOString(), "2026-11-14T00:00:00.000Z");
  const near = licenseView(
    { license: { level: "p1", deadlineAt: new Date("2026-10-15T00:00:00Z") } },
    NOW,
  );
  assert.equal(near.state, "ok");
  assert.equal(near.soon, true);
  const perpetual = licenseView({ license: { level: "p-unlimited" } }, NOW);
  assert.equal(perpetual.label, "CHR Unlimited");
  assert.equal(perpetual.until, null);
  assert.equal(perpetual.soon, false);
});
