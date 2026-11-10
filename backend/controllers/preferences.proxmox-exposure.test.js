const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSettings } = require("../services/proxmox/settings");
const exposure = require("./proxmoxExposure");
test("omitted links survive ordinary partial preference changes without MikroTik rights", async () => {
  const stored = {
    networkLinks: [{ cidr: "10.0.0.0/24" }],
    exposureTicketsEnabled: true,
  };
  const result = await validateSettings({ cpuThreshold: 85 }, stored, {
    can: () => false,
  });
  assert.deepEqual(result.changes, { cpuThreshold: 85 });
  assert.equal(result.data.exposureTicketsEnabled, true);
});
test("network catalog endpoint independently denies missing integration rights", async () => {
  await assert.rejects(
    exposure.options(
      { query: {}, auth: { can: () => false } },
      { json: () => assert.fail("no response data") },
    ),
    (e) => e.statusCode === 403 || e.status === 403,
  );
});
