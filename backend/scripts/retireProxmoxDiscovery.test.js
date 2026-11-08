const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanup } = require("./retireProxmoxDiscovery");
test("cleanup previews then idempotently drops only legacy discovery collections", async () => {
  const names = new Set([
    "proxmoxdiscoveryjobs",
    "proxmoxdiscoverycandidates",
    "proxmoxresources",
    "tickets",
  ]);
  const drops = [];
  const db = {
    listCollections: () => ({
      toArray: async () => [...names].map((name) => ({ name })),
    }),
    collection: (name) => ({
      countDocuments: async () => 2,
      drop: async () => {
        drops.push(name);
        names.delete(name);
      },
    }),
  };
  assert.equal((await cleanup(db)).collections.length, 2);
  assert.equal(drops.length, 0);
  await cleanup(db, true);
  assert.equal(drops.length, 2);
  assert.equal(names.has("tickets"), true);
  assert.equal(names.has("proxmoxresources"), true);
  assert.deepEqual((await cleanup(db, true)).collections, []);
});
