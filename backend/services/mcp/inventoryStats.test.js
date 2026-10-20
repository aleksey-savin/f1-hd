// node --test services/mcp/inventoryStats.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { aggregateInventoryStats, formatInventoryStats } = require("./inventoryStats");

const rows = [
  { type: "ПК", status: "deployed" },
  { type: "ПК", status: "readyForDeployment" },
  { type: "ПК", status: "disposed" },
  { type: "Принтер", status: "inRepair" },
  { type: "Принтер", status: "inReserve", parentDeviceId: "host" },
];
const label = (row) => row.type;

test("two groups: columns, retired = decommissioned + disposed, shares sum to 100.0", () => {
  const stats = aggregateInventoryStats(rows, { groupBy: "type", label });

  assert.equal(stats.total, 5);
  assert.deepEqual(stats.groups, [
    { label: "ПК", devices: 3, free: 1, deployed: 1, inRepair: 0, retired: 1, share: 60 },
    // inReserve у компонента не «свободно»
    { label: "Принтер", devices: 2, free: 0, deployed: 0, inRepair: 1, retired: 0, share: 40 },
  ]);
  assert.equal(stats.groups.reduce((sum, g) => sum + g.share, 0), 100);
  assert.match(formatInventoryStats(stats, { groupBy: "type" }), /\| ПК \| 3 \| 1 \| 1 \| 0 \| 1 \| 60% \|/);
});

test("ties sort by label; empty rows give zero total and the empty-fleet line", () => {
  const tied = aggregateInventoryStats([{ type: "Б" }, { type: "А" }], { groupBy: "type", label });
  assert.deepEqual(tied.groups.map((g) => g.label), ["А", "Б"]);

  const empty = aggregateInventoryStats([], { groupBy: "type", label });
  assert.deepEqual(empty, { total: 0, groups: [] });
  assert.match(formatInventoryStats(empty, { groupBy: "type" }), /Devices: 0.*\nNo devices match\.$/);
});
