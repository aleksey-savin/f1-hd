const test = require("node:test");
const assert = require("node:assert/strict");
const { buildNetworkReport } = require("./networkReport");

const row = (address, network, disabled = false) => ({ address, network, disabled: String(disabled) });
const record = (_id, addresses) => ({ _id, name: "Router", addresses });

test("nested networks on identically named devices count as separate devices; adjacent and disabled ranges stay out", () => {
  const report = buildNetworkReport([
    record("a", [row("10.0.0.135/28", "10.0.0.128"), row("10.0.1.2/24", "10.0.1.0")]),
    record("b", [row("10.0.0.52/24", "10.0.0.0"), row("10.0.0.2/16", "10.0.0.0", true)]),
  ]);
  assert.equal(report.overlaps.length, 1);
  assert.equal(report.overlaps[0].kind, "maskOverlap");
  assert.equal(report.overlaps[0].deviceCount, 2);
  assert.deepEqual(report.overlaps[0].masks, ["24", "28"]);
  assert.deepEqual(report.totals, { addresses: 4, networks: 3, devices: 2, disabled: 1 });
});

test("point-to-point /32 groups by the reported peer network", () => {
  const report = buildNetworkReport([
    record("a", [row("10.8.0.1/32", "192.0.2.132")]),
    record("b", [row("192.0.2.133/30", "192.0.2.132")]),
  ]);
  assert.equal(report.overlaps[0].kind, "maskOverlap");
});

test("one host assigned with different masks marks both interface addresses as clashes", () => {
  const report = buildNetworkReport([
    record("a", [row("192.0.2.129/24", "192.0.2.0")]),
    record("b", [row("192.0.2.129/25", "192.0.2.128")]),
  ]);
  assert.equal(report.overlaps[0].kind, "addressClash");
  assert.deepEqual(report.overlaps[0].clashing, ["192.0.2.129/24", "192.0.2.129/25"]);
});
