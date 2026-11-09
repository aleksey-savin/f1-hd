require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { staffAccessStatements } = require("../auth/access");
const { upgradeTaxiRoles } = require("./grantTaxiPermissions");

test("taxi migration upgrades only prior staff administrators and retries the mirror after interruption", async () => {
  const previous = staffAccessStatements(); delete previous.taxi;
  const partial = { ...previous, role: ["read"], ticket: previous.ticket.filter((action) => action !== "delete") };
  const rows = [
    { _id: "a", role: "admin", audience: "staff", permission: JSON.stringify(previous) },
    { _id: "b", role: "staff", audience: "staff", permission: JSON.stringify(partial) },
    { _id: "c", role: "client", audience: "client", permission: JSON.stringify(previous) },
  ];
  let writes = 0;
  const refreshed = [];
  const db = { collection: () => ({
    find: () => ({ toArray: async () => rows.map((row) => ({ ...row })) }),
    updateOne: async (filter, change) => { const row = rows.find((item) => item._id === filter._id && item.permission === filter.permission); if (!row) return { matchedCount: 0 }; Object.assign(row, change.$set); writes++; return { matchedCount: 1 }; },
  }) };
  const services = { invalidateRoles() {}, refreshMirrorFor: async (_orgId, key) => { refreshed.push(key); } };
  const dry = await upgradeTaxiRoles(db, "org", { apply: false, ...services });
  assert.deepEqual(dry.changed, ["admin"]); assert.equal(writes, 0);
  await upgradeTaxiRoles(db, "org", { apply: true, ...services });
  assert.deepEqual(JSON.parse(rows[0].permission).taxi, ["read", "allocate", "configure"]);
  assert.equal(JSON.parse(rows[1].permission).taxi, undefined);
  assert.equal(JSON.parse(rows[2].permission).taxi, undefined);
  await upgradeTaxiRoles(db, "org", { apply: true, ...services });
  assert.equal(writes, 1);
  assert.deepEqual(refreshed, ["admin", "admin"]);
});

test("taxi defaults include administrative roles with unrelated permission gaps, without granting those gaps or resetting their mirrors", async () => {
  const admin = staffAccessStatements();
  delete admin.taxi;
  delete admin.proxmox;
  const customAdmin = {
    ...admin,
    ticket: admin.ticket.filter((action) => action !== "closeWithoutWork"),
    mikrotik: admin.mikrotik.filter((action) => !["upgradeFirmware", "approveChanges"].includes(action)),
    taxi: ["read"],
  };
  const ordinary = { ...admin, settings: [] };
  const rows = [
    { _id: "admin", role: "admin", audience: "staff", permission: JSON.stringify(admin) },
    { _id: "custom", role: "administrator-ukazyvaet-raboty", audience: "staff", permission: JSON.stringify(customAdmin) },
    { _id: "client", role: "client-admin", audience: "client", permission: JSON.stringify(admin) },
    { _id: "ordinary", role: "ordinary", audience: "staff", permission: JSON.stringify(ordinary) },
  ];
  const before = rows.map((row) => row.permission);
  const refreshed = [];
  let writes = 0;
  const db = { collection: () => ({
    find: () => ({ toArray: async () => rows.map((row) => ({ ...row })) }),
    updateOne: async (filter, change) => {
      const row = rows.find((item) => item._id === filter._id && item.permission === filter.permission);
      if (!row) return { matchedCount: 0 };
      Object.assign(row, change.$set);
      writes++;
      return { matchedCount: 1 };
    },
  }) };
  const services = { invalidateRoles() {}, refreshMirrorFor: async (_orgId, key) => { refreshed.push(key); } };
  const dry = await upgradeTaxiRoles(db, "org", services);
  assert.deepEqual(dry.changed, ["admin", "administrator-ukazyvaet-raboty"]);
  assert.equal(writes, 0);
  await upgradeTaxiRoles(db, "org", { apply: true, ...services });
  for (const index of [0, 1]) {
    const actual = JSON.parse(rows[index].permission);
    assert.deepEqual(actual, { ...JSON.parse(before[index]), taxi: ["read", "allocate", "configure"] });
  }
  assert.equal(rows[2].permission, before[2]);
  assert.equal(rows[3].permission, before[3]);
  await upgradeTaxiRoles(db, "org", { apply: true, ...services });
  assert.equal(writes, 2);
  assert.deepEqual(refreshed, []);
});
