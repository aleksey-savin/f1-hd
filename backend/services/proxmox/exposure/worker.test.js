const test = require("node:test");
const assert = require("node:assert/strict");
const Preferences = require("../../../models/preferences");
const { tick } = require("./worker");
const { networkWriteFilter } = require("./worker");
test("disabled modules and missing links prevent every live collector and ticket call", async (t) => {
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => ({
      modules: { proxmox: { isActive: true }, mikrotik: { isActive: false } },
      proxmox: { networkLinks: [{}] },
    }),
  }));
  await tick({
    collectRouter: () => assert.fail(),
    collectGuest: () => assert.fail(),
  });
});
test("network writes reject an old node, generation, status or lifecycle even without a QEMU UUID", () => {
  const sift = require("sift").default;
  const before = {
    _id: "g",
    connectionId: "c",
    nodeName: "old",
    guestIdentity: null,
    exposureGeneration: 3,
    status: "running",
    monitoringEnabled: true,
  };
  const filter = networkWriteFilter(before);
  assert.equal(sift(filter)(before), true);
  for (const patch of [
    { nodeName: "new" },
    { exposureGeneration: 4 },
    { status: "stopped" },
    { missingSince: new Date() },
    { archived: true },
  ])
    assert.equal(sift(filter)({ ...before, ...patch }), false);
});
